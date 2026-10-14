import { Decrypter, Encrypter, armor } from "age-encryption";

// age 加密與解密。用的是 age 的官方 TypeScript 實作 typage（npm 的 age-encryption），
// 輸出的檔案可以用命令列的 age、rage 或其他相容的工具解開。

const ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";

export function isArmored(data: Uint8Array): boolean {
  return new TextDecoder().decode(data.subarray(0, ARMOR_HEADER.length)) === ARMOR_HEADER;
}

// 每行一把公鑰，空行與 # 開頭的註解略過。age1 開頭的才收，其他列成無效
export function parseRecipients(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    (/^age1[02-9ac-hj-np-z]{20,}$/.test(line) ? valid : invalid).push(line);
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
