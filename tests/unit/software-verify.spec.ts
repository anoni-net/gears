import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as openpgp from "openpgp";
import { SIGNERS, groupFingerprint, looksLikeSignature, signingKeys, verifyDownload } from "../../src/tools/software-verify/index.ts";

const dir = new URL("../helpers/signed/", import.meta.url);
const read = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));
const TOR_FILE = read("tor-browser-15.0.25-sha256sums.txt");
const TOR_SIG = read("tor-browser-15.0.25-sha256sums.txt.asc");

test("內建的公鑰讀得出來，主金鑰的指紋跟官方公告的相同", async () => {
  const keys = await signingKeys();
  for (const signer of SIGNERS) expect(keys.get(signer.id)!.getFingerprint().toUpperCase()).toBe(signer.fingerprint);
  expect(groupFingerprint(SIGNERS[0]!.fingerprint)).toBe("EF6E 286D DA85 EA2A 4BA7 DE68 4E2C 6E87 9329 8290");
});

test("Tor Browser 官方的簽章驗得過，算出 SHA-256", async () => {
  let progress = 0;
  const { outcome, sha256: hex } = await verifyDownload(new Blob([TOR_FILE]), TOR_SIG, (n) => (progress = n));
  expect(outcome).toMatchObject({ kind: "good", signer: "tor-browser", subkey: "022DA248432D2A0E0F54E65E316C1FACD62D07D9" });
  expect(outcome.kind === "good" && outcome.created.toISOString()).toBe("2026-10-12T23:14:34.000Z");
  expect(hex).toBe(bytesToHex(sha256(TOR_FILE)));
  expect(progress).toBe(TOR_FILE.length);
});

test("檔案改了一個位元：簽章對不上", async () => {
  const bad = TOR_FILE.slice();
  bad[100]! ^= 1;
  expect((await verifyDownload(new Blob([bad]), TOR_SIG)).outcome).toEqual({ kind: "bad", signer: "tor-browser" });
});

test("Tails 映像檔的簽章：簽署的子金鑰在內建的公鑰裡", async () => {
  const sig = read("tails-amd64-7.14.img.sig");
  expect(looksLikeSignature(sig)).toBe(true);
  const signature = await openpgp.readSignature({ armoredSignature: new TextDecoder().decode(sig) });
  const tails = (await signingKeys()).get("tails")!;
  expect(signature.getSigningKeyIDs().some((id) => tails.getKeys(id).length)).toBe(true);
});

test("其他金鑰簽的、不是簽章的檔案", async () => {
  const { privateKey, publicKey } = await openpgp.generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "Someone" }], format: "object" });
  const data = new TextEncoder().encode("installer");
  const armored = await openpgp.sign({ message: await openpgp.createMessage({ binary: data }), signingKeys: privateKey, detached: true });
  const other = await verifyDownload(new Blob([data]), new TextEncoder().encode(armored as string));
  expect(other.outcome).toEqual({ kind: "unknown-key", keyId: publicKey.getKeys()[0]!.getKeyID().toHex().toUpperCase() });
  expect(other.sha256).toBe(bytesToHex(sha256(data)));

  expect((await verifyDownload(new Blob([data]), TOR_FILE)).outcome).toEqual({ kind: "not-signature" });
  expect(looksLikeSignature(TOR_FILE)).toBe(false);
  expect(looksLikeSignature(TOR_SIG)).toBe(true);
});
