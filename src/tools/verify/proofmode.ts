import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type ZipEntry, entryData, readZip } from "../../core/zip.ts";

// ProofMode（Guardian Project 的紀錄工具，guardianproject/proofmode-android）分享出來的壓縮檔。
// 照片本身不改動，旁邊放著用 App 自動產生的 OpenPGP 金鑰簽好的證明檔：
//
// - pubkey.asc：簽署用的公鑰
// - <SHA-256>.asc：照片的分離式簽章，檔名是照片的 SHA-256
// - <SHA-256>.proof.csv、.proof.json：拍攝當下的感測器資料，各自帶著 .asc 簽章
// - 選用的 .ots（OpenTimestamps）與 .gst（Google 的裝置完整性證明）
//
// 金鑰沒有對應到身分，驗得出照片與感測器資料簽完之後沒被改過，驗不出簽的人是誰，畫面上請讀者
// 比對公鑰的指紋。.ots 要讀 Bitcoin 的區塊資料、.gst 要用 Google 的金鑰，兩者只列出有沒有附上。

export type SigResult = { kind: "good"; created?: number } | { kind: "bad" } | { kind: "missing" } | { kind: "unreadable" };

export interface ProofItem {
  hash: string; // 證明檔名裡的 SHA-256
  media?: { name: string; data: Uint8Array };
  mediaSig: SigResult;
  proofSig: SigResult; // .proof.json 有就驗它，沒有才驗 .proof.csv
  fields: [string, string][];
  ots: boolean;
  gst: boolean;
}

export interface ProofModeEvidence {
  fingerprint?: string;
  userIds: string[];
  items: ProofItem[];
  unmatched: string[]; // 壓縮檔裡對不到任何證明檔的照片或影片，常是照片被換過或改過
}

const PROOF = /^(?:.*\/)?([0-9a-f]{64})\.proof\.(csv|json)$/i;
const MAX_ENTRY = 256 * 1024 * 1024;

// 壓縮檔裡有 pubkey.asc 與至少一份 <SHA-256>.proof.csv 或 .proof.json 就當成 ProofMode 的證明檔
export function proofHashes(names: string[]): string[] {
  if (!names.some((n) => n.split("/").at(-1) === "pubkey.asc")) return [];
  return [...new Set(names.map((n) => PROOF.exec(n)?.[1]?.toLowerCase()).filter((h): h is string => !!h))];
}

const sha = (data: Uint8Array) => bytesToHex(sha256(data));

// CSV 第一列是欄位名稱，之後每次補寫加一列，取最後一列。值裡的逗號已經被 App 換成空白
export function parseProofCsv(text: string): [string, string][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const keys = lines[0]!.split(",");
  const values = lines.at(-1)!.split(",");
  return keys.map((k, i) => [k.trim(), (values[i] ?? "").trim()] as [string, string]).filter(([k, v]) => k && v);
}

export function parseProofJson(text: string): [string, string][] {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
      .map(([k, v]) => [k, String(v).trim().slice(0, 2000)] as [string, string]);
  } catch {
    return [];
  }
}

type OpenPgp = typeof import("../software-verify/openpgp.ts");

async function verify(openpgp: OpenPgp, key: Awaited<ReturnType<OpenPgp["readKey"]>> | undefined, data: Uint8Array | undefined, armored: string | undefined): Promise<SigResult> {
  if (!armored || !data) return { kind: "missing" };
  if (!key) return { kind: "unreadable" };
  let signature: Awaited<ReturnType<OpenPgp["readSignature"]>>;
  try {
    signature = await openpgp.readSignature({ armoredSignature: armored });
  } catch {
    return { kind: "unreadable" };
  }
  try {
    const message = await openpgp.createMessage({ binary: data });
    const result = await openpgp.verify({ message, signature, verificationKeys: [key], format: "binary" });
    const [sig] = result.signatures;
    if (!sig) return { kind: "bad" };
    await sig.verified;
    const created = (await sig.signature).packets[0]?.created;
    return { kind: "good", created: created ? created.getTime() : undefined };
  } catch {
    return { kind: "bad" };
  }
}

export async function examineProofMode(bytes: Uint8Array): Promise<ProofModeEvidence | undefined> {
  let entries: ZipEntry[];
  try {
    entries = readZip(bytes).entries.filter((e) => !e.name.endsWith("/") && e.size <= MAX_ENTRY);
  } catch {
    return undefined;
  }
  const hashes = proofHashes(entries.map((e) => e.name));
  if (!hashes.length) return undefined;
  const base = (e: ZipEntry) => e.name.split("/").at(-1)!;
  const find = (name: string) => entries.find((e) => base(e).toLowerCase() === name.toLowerCase());
  const read = async (name: string) => {
    const e = find(name);
    return e ? entryData(bytes, e) : undefined;
  };
  const text = async (name: string) => {
    const data = await read(name);
    return data ? new TextDecoder().decode(data) : undefined;
  };

  const openpgp: OpenPgp = await import("../software-verify/openpgp.ts");
  const evidence: ProofModeEvidence = { userIds: [], items: [], unmatched: [] };
  let key: Awaited<ReturnType<OpenPgp["readKey"]>> | undefined;
  try {
    key = await openpgp.readKey({ armoredKey: (await text("pubkey.asc")) ?? "" });
    evidence.fingerprint = key.getFingerprint().toUpperCase();
    evidence.userIds = key.getUserIDs().map((u) => u.slice(0, 120));
  } catch {
    key = undefined;
  }

  // 照片的檔名是原本的名字，用 SHA-256 對到證明檔
  const sidecar = /(\.asc|\.ots|\.gst|\.proof\.csv|\.proof\.json|^pubkey\.asc|\.txt|\.pem|\.crt)$/i;
  const media = new Map<string, { name: string; data: Uint8Array }>();
  for (const e of entries) {
    if (sidecar.test(base(e))) continue;
    const data = await entryData(bytes, e);
    const hash = sha(data);
    if (hashes.includes(hash)) media.set(hash, { name: base(e), data });
    else evidence.unmatched.push(base(e));
  }

  for (const hash of hashes) {
    const found = media.get(hash);
    const json = await read(`${hash}.proof.json`);
    const csv = await read(`${hash}.proof.csv`);
    const proofData = json ?? csv;
    const proofSigText = await text(json ? `${hash}.proof.json.asc` : `${hash}.proof.csv.asc`);
    const fields = json ? parseProofJson(new TextDecoder().decode(json)) : csv ? parseProofCsv(new TextDecoder().decode(csv)) : [];
    evidence.items.push({
      hash,
      media: found,
      mediaSig: await verify(openpgp, key, found?.data, await text(`${hash}.asc`)),
      proofSig: await verify(openpgp, key, proofData, proofSigText),
      fields,
      ots: !!find(`${hash}.ots`),
      gst: !!find(`${hash}.gst`),
    });
  }
  return evidence;
}
