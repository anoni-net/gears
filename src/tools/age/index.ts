import { Decrypter, Encrypter, armor, generateX25519Identity, identityToRecipient } from "age-encryption";

// age 加密與解密。用的是 age 的官方 TypeScript 實作 typage（npm 的 age-encryption），
// 輸出的檔案可以用命令列的 age、rage 或其他相容的工具解開。

// 公鑰與私鑰要用 WebCrypto 的 X25519。瀏覽器只在 HTTPS（或 localhost、.onion）上提供
// crypto.subtle，HTTP 頁面上是 undefined。typage 在瀏覽器不支援 X25519 時會改用 noble 的
// 實作，但 crypto.subtle 整個不存在時拋出的是 TypeError，它不會接住，所以先在這裡檢查。
// 用密語加密走 scrypt 與 ChaCha20-Poly1305 的純 JavaScript 實作，不受影響。
export function keysAvailable(): boolean {
  return typeof globalThis.crypto?.subtle !== "undefined";
}

const ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";

export function isArmored(data: Uint8Array): boolean {
  return new TextDecoder().decode(data.subarray(0, ARMOR_HEADER.length)) === ARMOR_HEADER;
}

// 每行一把公鑰，空行與 # 開頭的註解略過。age1 開頭的才收（後量子的混合公鑰是 age1pq1），
// 其他列成無效
export function parseRecipients(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    (/^age1(pq1)?[02-9ac-hj-np-z]{20,}$/.test(line) ? valid : invalid).push(line);
  }
  return { valid, invalid };
}

export interface EncryptOptions {
  passphrase?: string;
  recipients?: string[];
  armored: boolean;
  scryptLogN?: number; // 測試用，正式使用維持函式庫的預設值
}

export async function encrypt(data: Uint8Array, opts: EncryptOptions): Promise<Uint8Array> {
  const e = new Encrypter();
  if (opts.passphrase) {
    e.setPassphrase(opts.passphrase);
    if (opts.scryptLogN) e.setScryptWorkFactor(opts.scryptLogN);
  } else if (opts.recipients?.length) {
    for (const r of opts.recipients) e.addRecipient(r);
  } else {
    throw new Error("no key");
  }
  const out = await e.encrypt(data);
  return opts.armored ? new TextEncoder().encode(armor.encode(out)) : out;
}

// key 是密語，或 AGE-SECRET-KEY- 開頭的私鑰（可以多把，一行一把）
export async function decrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
  const d = new Decrypter();
  const lines = key
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length && lines.every((l) => l.startsWith("AGE-SECRET-KEY-"))) {
    for (const l of lines) d.addIdentity(l);
  } else {
    d.addPassphrase(key);
  }
  const binary = isArmored(data) ? armor.decode(new TextDecoder().decode(data)) : data;
  return d.decrypt(binary, "uint8array");
}

// 產生一組 X25519 金鑰。age 也有後量子的混合金鑰，但要 age 1.3 以上才解得開，
// 相容性比較差，先用 X25519。
export async function generateKeyPair(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

// 跟命令列的 age-keygen 輸出同一種格式，存下來可以直接給 age -i 使用，
// 貼進工作台的解密畫面時，# 開頭的註解行會略過。
export function keyFileText(identity: string, recipient: string, created: Date): string {
  return `# created: ${created.toISOString()}\n# public key: ${recipient}\n${identity}\n`;
}
