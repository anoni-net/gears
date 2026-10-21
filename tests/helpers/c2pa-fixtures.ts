import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// C2PA 內容憑證的測試圖取自官方 c2pa-rs 的測試資料（sdk/tests/fixtures，MIT 或 Apache-2.0），
// 照片不進 repo，測試開始前下載到 tests/.generated/c2pa-*，鎖定 commit 並比對 SHA-256。
// 下載不了時，用到的測試會略過
//
// - C.jpg：c2pa-rs 的測試憑證簽的，簽章有效、簽署者不在信任清單裡，動作是程式產生（algorithmicMedia）
// - XCA.jpg：簽署之後影像資料被改過（assertion.dataHash.mismatch）
// - E-sig-CA.jpg：簽章被改壞（claimSignature.mismatch）
// - ocsp.jpg：Adobe Photoshop 簽的，簽署者只在 2026 年凍結的過渡清單裡，查證只用正式清單，列為不受信任
const COMMIT = "60f7cbdc69ab7a2554fcc87eb4df77050814b2cf";
export const C2PA_FIXTURES: Record<string, string> = {
  "C.jpg": "a2d14755db55de67a47c04090340d8266e892367be4104a45626d7a6fa6e9ffd",
  "XCA.jpg": "81f20702a2e81611b29aa773f811b59ade6095acd3d089d6ffdae6b591d6d5a5",
  "E-sig-CA.jpg": "20dc072a4c843d3b7d7cb4f4002fbb4d8f20d7ee859ca726f2458c1e0358a98c",
  "ocsp.jpg": "49a6b089bf3fe610960ef91b2beb81c86b62e7d531c97f33fc029841d864b2cb",
};

export const c2paFixture = (name: string) => `tests/.generated/c2pa-${name}`;
export const hasC2paFixtures = () => Object.keys(C2PA_FIXTURES).every((name) => existsSync(c2paFixture(name)));

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export async function fetchC2paFixtures() {
  for (const [name, hash] of Object.entries(C2PA_FIXTURES)) {
    const path = c2paFixture(name);
    if (existsSync(path) && sha(readFileSync(path)) === hash) continue;
    try {
      const res = await fetch(`https://raw.githubusercontent.com/contentauth/c2pa-rs/${COMMIT}/sdk/tests/fixtures/${name}`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (!res.ok || sha(data) !== hash) throw new Error(`${name}: ${res.status}`);
      writeFileSync(path, data);
    } catch {
      console.warn("沒有辦法下載 C2PA 的測試圖，用到的測試會略過");
      return;
    }
  }
}
