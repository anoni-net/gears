import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { initSync, WasmReader } from "@contentauth/c2pa-wasm";
import { resolveSettings } from "@contentauth/c2pa-utilities";
import type { ManifestStore } from "@contentauth/c2pa-types";
import { summarizeStore } from "../../src/tools/verify/c2pa.ts";
import { c2paFixture, hasC2paFixtures } from "../helpers/c2pa-fixtures.ts";

// 用 c2pa-web 裡面同一份 WebAssembly 在 Node 裡驗證，設定跟 src/ui/c2pa-check.ts 相同，
// 只用 C2PA 的正式信任清單
test.skip(!hasC2paFixtures(), "沒有 C2PA 的測試圖");

const trust = (name: string) => readFileSync(`src/tools/verify/c2pa-trust/${name}`, "utf8");
const verify = { verifyTrust: true, verifyTimestampTrust: true, remoteManifestFetch: false, ocspFetch: false };

async function read(name: string) {
  initSync({ module: readFileSync("node_modules/@contentauth/c2pa-wasm/pkg/c2pa_bg.wasm") });
  const bytes = new Uint8Array(readFileSync(c2paFixture(name)));
  const store = async (settings: object) => {
    const reader = await WasmReader.fromBytes("image/jpeg", bytes, await resolveSettings(settings));
    return reader.manifestStore() as ManifestStore;
  };
  return summarizeStore(await store({ verify, trust: { trustAnchors: `${trust("official.pem")}\n${trust("official-tsa.pem")}` } }));
}

test("簽章有效、簽署者不在信任清單裡：c2pa-rs 的測試憑證", async () => {
  const check = await read("C.jpg");
  expect(check).toMatchObject({ state: "valid", signer: "C2PA Signer", issuer: "C2PA Test Signing Cert", timestamp: "trusted", revocation: "unchecked", problems: [] });
  expect(check?.actions).toEqual([{ action: "c2pa.created", softwareAgent: "Make Test Images 0.33.1", digitalSource: "algorithmicMedia" }]);
  expect(check?.generator).toBe("make_test_images 0.33.1、c2pa-rs 0.33.1");
});

test("簽署之後內容被改過、簽章被改壞", async () => {
  expect((await read("XCA.jpg"))?.problems).toEqual(["content-changed"]);
  expect((await read("XCA.jpg"))?.state).toBe("invalid");
  expect((await read("E-sig-CA.jpg"))?.problems).toEqual(["signature-invalid"]);
});

test("只在過渡清單裡的簽署者（較早的 Adobe 憑證）列為不受信任，動作紀錄照樣列出", async () => {
  const check = await read("ocsp.jpg");
  expect(check).toMatchObject({ state: "valid", issuer: "Adobe Inc.", signer: "Adobe C2PA", revocation: "unchecked", problems: [], ingredients: 1 });
  expect(check?.actions.map((a) => a.action)).toContain("c2pa.opened");
  expect(check?.actions.find((a) => a.action === "c2pa.opened")?.digitalSource).toBe("compositeWithTrainedAlgorithmicMedia");
});
