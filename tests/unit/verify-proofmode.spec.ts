import { expect, test } from "@playwright/test";
import { entryData, readZip, writeZip } from "../../src/core/zip.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { examine } from "../../src/tools/verify/examine.ts";
import { parseProofCsv, proofHashes } from "../../src/tools/verify/proofmode.ts";
import { type CaseFile, summarize } from "../../src/tools/verify/summary.ts";
import { bytes } from "../helpers/fixtures.ts";
import { proofModeBundle as bundle } from "../helpers/proofmode.ts";

const caseFile = (evidence: CaseFile["evidence"]): CaseFile => ({ index: 1, name: "proof.zip", format: "zip", size: 1, evidence });

test("認得 ProofMode 的檔名，CSV 取最後一列", () => {
  const hash = "a".repeat(64);
  expect(proofHashes(["pubkey.asc", `${hash}.proof.csv`, `${hash}.proof.json`, "photo.jpg"])).toEqual([hash]);
  expect(proofHashes([`${hash}.proof.csv`])).toEqual([]);
  expect(parseProofCsv("A,B,\n1,2,\n3,,\n")).toEqual([["A", "3"]]);
});

test("簽章正確：照片、感測器資料、公鑰指紋，時間、位置與裝置併進查證", async () => {
  const { zip, hash, fingerprint } = await bundle();
  const ev = await examine(zip, "zip");
  const pm = ev.proofmode!;
  expect(pm.fingerprint).toBe(fingerprint);
  expect(pm.items).toHaveLength(1);
  const item = pm.items[0]!;
  expect(item.hash).toBe(hash);
  expect(item.media?.name).toBe("IMG_0001.jpg");
  expect(item.mediaSig.kind).toBe("good");
  expect(item.proofSig.kind).toBe("good");
  expect(item.ots).toBe(true);
  expect(item.gst).toBe(false);
  expect(item.fields).toContainEqual(["Wifi MAC", "02:00:00:00:00:00"]);
  expect(ev.locations).toContainEqual({ lat: 25.033, lon: 121.5654 });
  expect(ev.devices).toContain("TestPhone test-board");
  expect(ev.times).toContainEqual(expect.objectContaining({ kind: "proof", source: "proofmode", text: "2026-10-21 02:00:00" }));
  expect(summarize([caseFile(ev)]).warnings.map((w) => w.code)).not.toContain("proofmode-mismatch");
});

test("感測器資料或照片被改過時簽章對不上，列在需要留意的地方", async () => {
  const proof = await examine((await bundle({ tamperProof: true })).zip, "zip");
  expect(proof.proofmode!.items[0]!.proofSig.kind).toBe("bad");
  expect(summarize([caseFile(proof)]).warnings).toContainEqual(expect.objectContaining({ code: "proofmode-mismatch", value: "1" }));

  // 照片改過之後 SHA-256 對不到證明檔，當成壓縮檔裡沒有這張照片
  const media = await examine((await bundle({ tamperMedia: true })).zip, "zip");
  expect(media.proofmode!.items[0]!.media).toBeUndefined();
  expect(media.proofmode!.items[0]!.mediaSig.kind).toBe("missing");
  expect(media.proofmode!.unmatched).toEqual(["IMG_0001.jpg"]);
  expect(summarize([caseFile(media)]).warnings).toContainEqual(expect.objectContaining({ code: "proofmode-mismatch" }));

  const dropped = await examine((await bundle({ dropMedia: true })).zip, "zip");
  expect(dropped.proofmode!.items[0]!.media).toBeUndefined();
  expect(dropped.proofmode!.items[0]!.proofSig.kind).toBe("good");
  // 只分享證明檔、沒有附照片是正常的用法，不算需要留意
  expect(summarize([caseFile(dropped)]).warnings.map((w) => w.code)).not.toContain("proofmode-mismatch");
});

test("一般的壓縮檔沒有 proofmode", async () => {
  const zip = await writeZip([{ name: "a.txt", data: bytes("hello"), compress: true }]);
  expect((await examine(zip, "zip")).proofmode).toBeUndefined();
});

test("清除中繼資料：照片與證明檔保留原樣，列出感測器資料裡的位置與網路", async () => {
  const { zip, hash, media } = await bundle();
  const findings = await stripMetadata.inspect(zip, "zip");
  expect(findings.find((f) => f.code === "proofmode")?.value).toBe("Location.Latitude, Location.Longitude, Wifi MAC");

  const { data, report } = await stripMetadata.run(zip, "zip");
  expect(report.kept.map((k) => k.code)).toContain("archive-proofmode");
  const archive = readZip(data);
  const photo = archive.entries.find((e) => e.name === "IMG_0001.jpg")!;
  expect(Buffer.from(await entryData(data, photo)).equals(Buffer.from(media))).toBe(true);
  // 清除之後簽章照樣驗得過
  const after = await examine(data, "zip");
  expect(after.proofmode!.items[0]!.hash).toBe(hash);
  expect(after.proofmode!.items[0]!.mediaSig.kind).toBe("good");
  expect(after.proofmode!.items[0]!.proofSig.kind).toBe("good");
});
