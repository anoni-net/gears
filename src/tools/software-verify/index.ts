// 下載的軟體驗證：用內建的簽章公鑰確認下載的檔案是官方簽署、沒有被改過的。
// 讀者選下載的檔案與旁邊的簽章檔（.asc、.sig），用 OpenPGP 的分離式簽章驗證。
// 檔案用串流讀，幾 GB 的 Tails 映像檔也不必整個讀進記憶體，同時算出 SHA-256。
// 公鑰由 scripts/signing-keys.mjs 產生（keys.ts），每月跟著文件站的查證核對一次。

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type * as OpenPGP from "openpgp";
import { ARMORED_KEYS } from "./keys.ts";

export interface Signer {
  id: "tor-browser" | "tails";
  // 官方頁面公告的主金鑰指紋，keys.ts 的公鑰要對得上
  fingerprint: string;
  // 讀者可以自己對照的官方說明頁
  source: string;
}

export const SIGNERS: Signer[] = [
  { id: "tor-browser", fingerprint: "EF6E286DDA85EA2A4BA7DE684E2C6E8793298290", source: "https://support.torproject.org/tbb/how-to-verify-signature/" },
  { id: "tails", fingerprint: "A490D0F4D311A4153E2BB7CADBB802B258ACD84F", source: "https://tails.net/doc/about/openpgp_keys/" },
];

export type Outcome =
  // 簽章正確：這把金鑰簽的，檔案跟簽署時一樣
  | { kind: "good"; signer: Signer["id"]; subkey: string; created: Date }
  // 簽章是這把金鑰簽的，但檔案跟簽署時不一樣（下載不完整、被改過，或簽章檔配錯了檔案）
  | { kind: "bad"; signer: Signer["id"] }
  // 簽章不是內建的任何一把金鑰簽的
  | { kind: "unknown-key"; keyId: string }
  // 簽章檔讀不出來
  | { kind: "not-signature" };

// 4 個字元一組，讀者對照官方頁面時比較好讀
export const groupFingerprint = (fp: string) => fp.toUpperCase().replace(/(.{4})(?!$)/g, "$1 ");

const load = () => import("./openpgp.ts");

let loaded: Promise<Map<Signer["id"], OpenPGP.PublicKey>> | null = null;
export function signingKeys() {
  loaded ??= (async () => {
    const openpgp = await load();
    const map = new Map<Signer["id"], OpenPGP.PublicKey>();
    for (const signer of SIGNERS) {
      const key = await openpgp.readKey({ armoredKey: ARMORED_KEYS[signer.id]! });
      if (key.getFingerprint().toUpperCase() !== signer.fingerprint) throw new Error(`fingerprint mismatch: ${signer.id}`);
      map.set(signer.id, key);
    }
    return map;
  })();
  return loaded;
}

const ARMOR = "-----BEGIN PGP SIGNATURE-----";

// 檔案開頭看起來是不是 OpenPGP 的簽章：ASCII armor，或二進位的簽章封包（舊格式 tag 2、新格式 0xC2）
export function looksLikeSignature(head: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(head.subarray(0, 64)).trimStart();
  if (text.startsWith(ARMOR)) return true;
  const b = head[0] ?? 0;
  return b === 0xc2 || (b & 0xfc) === 0x88;
}

async function readSignature(bytes: Uint8Array): Promise<OpenPGP.Signature | null> {
  const openpgp = await load();
  try {
    const text = new TextDecoder("latin1").decode(bytes);
    return text.includes(ARMOR) ? await openpgp.readSignature({ armoredSignature: text }) : await openpgp.readSignature({ binarySignature: bytes });
  } catch {
    return null;
  }
}

// 驗證分離式簽章。onProgress 回報讀了多少位元組
export async function verifyDownload(
  file: Blob,
  signatureBytes: Uint8Array,
  onProgress?: (done: number) => void,
): Promise<{ outcome: Outcome; sha256: string }> {
  const keys = await signingKeys();
  const signature = await readSignature(signatureBytes);
  const hash = sha256.create();
  const consume = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    let done = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hash.update(chunk.value);
      done += chunk.value.length;
      onProgress?.(done);
    }
  };
  const issuers = signature?.getSigningKeyIDs() ?? [];
  if (!signature || !issuers.length) {
    await consume(file.stream());
    return { outcome: { kind: "not-signature" }, sha256: bytesToHex(hash.digest()) };
  }
  const signer = [...keys].find(([, key]) => issuers.some((id) => key.getKeys(id).length));
  if (!signer) {
    await consume(file.stream());
    return { outcome: { kind: "unknown-key", keyId: issuers[0]!.toHex().toUpperCase() }, sha256: bytesToHex(hash.digest()) };
  }
  const [id, key] = signer;
  const openpgp = await load();
  const message = await openpgp.createMessage({ binary: file.stream() as ReadableStream<Uint8Array> });
  // 金鑰在簽署當時有效就算數（openpgp.js 依簽章的建立時間檢查），子金鑰之後到期不影響
  const result = await openpgp.verify({ message, signature, verificationKeys: [key], format: "binary" });
  await consume(result.data as ReadableStream<Uint8Array>);
  const sha = bytesToHex(hash.digest());
  const [sig] = result.signatures;
  try {
    await sig!.verified;
    const packet = (await sig!.signature).packets[0]!;
    const subkey = key.getKeys(sig!.keyID)[0]!.getFingerprint().toUpperCase();
    return { outcome: { kind: "good", signer: id, subkey, created: packet.created! }, sha256: sha };
  } catch {
    return { outcome: { kind: "bad", signer: id }, sha256: sha };
  }
}
