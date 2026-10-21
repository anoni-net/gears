import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as openpgp from "openpgp";
import { type NewEntry, writeZip } from "../../src/core/zip.ts";
import { bytes, syntheticJpeg } from "./fixtures.ts";

// 跟 ProofMode 分享出來的壓縮檔同樣的結構，金鑰在測試裡產生。感測器資料是編出來的，
// 位置用公開的地標（台北 101），MAC 位址用保留給本機的值
const FIELDS = {
  "File Hash SHA256": "",
  "Proof Generated": "2026-10-21T02:00:00.000Z",
  "File Created": "2026-10-21T01:59:58.000Z",
  Manufacturer: "TestPhone",
  Hardware: "test-board",
  "Location.Latitude": "25.0330",
  "Location.Longitude": "121.5654",
  "Wifi MAC": "02:00:00:00:00:00",
  Notes: "",
};

export async function proofModeBundle(opts: { tamperProof?: boolean; tamperMedia?: boolean; dropMedia?: boolean } = {}) {
  const { privateKey, publicKey } = await openpgp.generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ email: "noone@proofmode.example" }], format: "object" });
  const sign = async (data: Uint8Array) =>
    (await openpgp.sign({ message: await openpgp.createMessage({ binary: data }), signingKeys: privateKey, detached: true })) as string;
  const media = syntheticJpeg();
  const hash = bytesToHex(sha256(media));
  const fields = { ...FIELDS, "File Hash SHA256": hash };
  const json = bytes(JSON.stringify(fields));
  const csv = bytes(`${Object.keys(fields).join(",")},\n${Object.values(fields).join(",")},\n`);
  const entries: NewEntry[] = [
    { name: `${hash}.asc`, data: bytes(await sign(media)), compress: true },
    { name: `${hash}.proof.csv`, data: csv, compress: true },
    { name: `${hash}.proof.csv.asc`, data: bytes(await sign(csv)), compress: true },
    { name: `${hash}.proof.json`, data: opts.tamperProof ? bytes(JSON.stringify({ ...fields, "Location.Latitude": "24.0000" })) : json, compress: true },
    { name: `${hash}.proof.json.asc`, data: bytes(await sign(json)), compress: true },
    { name: `${hash}.ots`, data: new Uint8Array([0, 1, 2]), compress: false },
    { name: "pubkey.asc", data: bytes(publicKey.armor()), compress: true },
    { name: "HowToVerifyProofData.txt", data: bytes("how to verify"), compress: true },
  ];
  if (!opts.dropMedia) {
    const data = opts.tamperMedia ? media.slice() : media;
    if (opts.tamperMedia) data[data.length - 1] ^= 0xff; // 換掉最後一個位元組，SHA-256 也跟著變
    entries.unshift({ name: "IMG_0001.jpg", data, compress: false });
  }
  return { zip: await writeZip(entries), hash, media, fingerprint: publicKey.getFingerprint().toUpperCase() };
}
