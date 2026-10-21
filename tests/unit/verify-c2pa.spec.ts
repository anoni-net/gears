import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { initSync, WasmReader } from "@contentauth/c2pa-wasm";
import { resolveSettings } from "@contentauth/c2pa-utilities";
import type { ManifestStore } from "@contentauth/c2pa-types";
import { needsInterim, summarizeStore } from "../../src/tools/verify/c2pa.ts";
import { c2paFixture, hasC2paFixtures } from "../helpers/c2pa-fixtures.ts";

// 用 c2pa-web 裡面同一份 WebAssembly 在 Node 裡驗證，設定跟 src/ui/c2pa-check.ts 相同：
// 先用正式清單，簽署者不受信任時改用過渡清單
test.skip(!hasC2paFixtures(), "沒有 C2PA 的測試圖");

// 頁面的 CSP 只允許連自己的網域。c2pa-rs 驗證身分聲明的簽發者時會連線，這裡跟瀏覽器一樣擋下，
// 測試也不會連到外面
const realFetch = globalThis.fetch;
test.beforeAll(() => {
  globalThis.fetch = () => Promise.reject(new TypeError("blocked by the test, like the page's CSP"));
});
test.afterAll(() => {
  globalThis.fetch = realFetch;
});

const trust = (name: string) => readFileSync(`src/tools/verify/c2pa-trust/${name}`, "utf8");
const verify = { verifyTrust: true, verifyTimestampTrust: true, remoteManifestFetch: false, ocspFetch: false };

async function read(name: string, format = "image/jpeg") {
  initSync({ module: readFileSync("node_modules/@contentauth/c2pa-wasm/pkg/c2pa_bg.wasm") });
  const bytes = new Uint8Array(readFileSync(c2paFixture(name)));
  const store = async (settings: object) => {
    const reader = await WasmReader.fromBytes(format, bytes, await resolveSettings(settings));
    return reader.manifestStore() as ManifestStore;
  };
  const official = await store({ verify, trust: { trustAnchors: `${trust("official.pem")}\n${trust("official-tsa.pem")}` } });
  if (!needsInterim(official)) return summarizeStore(official, "official");
  const interim = summarizeStore(await store({ verify, trust: { trustAnchors: trust("interim-anchors.pem"), allowedList: trust("interim-allowed.pem"), trustConfig: trust("interim-store.cfg") } }), "interim");
  return interim?.state === "trusted" ? interim : summarizeStore(official, "official");
}

test("簽章有效、簽署者不在信任清單裡：c2pa-rs 的測試憑證", async () => {
  const check = await read("C.jpg");
  expect(check).toMatchObject({ state: "valid", trustList: undefined, signer: "C2PA Signer", issuer: "C2PA Test Signing Cert", timestamp: "trusted", revocation: "unchecked", problems: [] });
  expect(check?.actions).toEqual([{ action: "c2pa.created", softwareAgent: "Make Test Images 0.33.1", digitalSource: "algorithmicMedia" }]);
  expect(check?.generator).toBe("make_test_images 0.33.1、c2pa-rs 0.33.1");
});

test("簽署之後內容被改過、簽章被改壞", async () => {
  expect((await read("XCA.jpg"))?.problems).toEqual(["content-changed"]);
  expect((await read("XCA.jpg"))?.state).toBe("invalid");
  expect((await read("E-sig-CA.jpg"))?.problems).toEqual(["signature-invalid"]);
});

test("正式清單沒有的簽署者改用過渡清單，檔案內附的 OCSP 回應顯示沒有被撤銷", async () => {
  const check = await read("ocsp.jpg");
  expect(check).toMatchObject({ state: "trusted", trustList: "interim", issuer: "Adobe Inc.", revocation: "not-revoked", ingredients: 1 });
  expect(check?.actions.map((a) => a.action)).toContain("c2pa.opened");
  expect(check?.actions.find((a) => a.action === "c2pa.opened")?.digitalSource).toBe("compositeWithTrainedAlgorithmicMedia");
});

test("CAWG 身分聲明：X.509 憑證簽的只有簽署者，Identity Claims Aggregation 帶著驗證過的帳號", async () => {
  const x509 = await read("C_with_CAWG_data.jpg");
  expect(x509?.identities).toEqual([{ kind: "x509", issuer: "C2PA Test Signing Cert", signer: "C2PA Signer", accounts: [] }]);
  expect(x509?.identityStatus).toBe("untrusted");
  expect(x509?.training).toEqual([
    { kind: "cawg.ai_inference", use: "notAllowed" },
    { kind: "cawg.ai_generative_training", use: "notAllowed" },
  ]);

  const ica = await read("adobe_connected_identities.jpg");
  expect(ica?.identities).toEqual([
    {
      kind: "ica",
      issuer: "did:web:connected-identities.identity-stage.adobe.com",
      signer: undefined,
      accounts: [{ type: "cawg.social_media", provider: "behance", username: "testuser23", name: undefined, uri: "https://net.s2stagehance.com/testuser23", verifiedAt: "2025-04-09T22:45:26Z" }],
    },
  ]);
  // 簽發者的金鑰要連線取得，擋下之後列為沒有確認，內容憑證本身照樣是有效的（簽署者在過渡清單裡）
  expect(ica?.identityStatus).toBe("offline");
  expect(ica).toMatchObject({ state: "trusted", trustList: "interim", problems: [] });
});

test("影片的內容憑證：MP4", async () => {
  expect(await read("video1.mp4", "video/mp4")).toMatchObject({ state: "valid", problems: [] });
});

