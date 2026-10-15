import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { encodeQr, qrPng } from "../src/tools/qrcode/index.ts";

export const GENERATED = "tests/.generated";
export const QR_TEXT = "https://anoni.net/gears/";

// 瀏覽器測試開始前產生真的 HEIC（libheif 不附 HEVC 編碼器，只能用 pillow-heif 產生）。
// 有 uv 就用 uv，沒有就用系統的 python3。產生不了時，用到真 HEIC 的測試會略過。
export default function globalSetup() {
  mkdirSync(GENERATED, { recursive: true });
  const qr = `${GENERATED}/qr.png`;
  writeFileSync(qr, qrPng(encodeQr(QR_TEXT, "M"), 8));
  const script = "scripts/make-test-heic.py";
  const attempts: [string, string[]][] = [
    ["uv", ["run", "--quiet", "--with", "pillow-heif==1.8.1", "python", script, GENERATED, qr]],
    ["python3", [script, GENERATED, qr]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: "pipe", timeout: 120_000 });
      if (existsSync(`${GENERATED}/photo.heic`)) return;
    } catch {
      // 換下一種方式
    }
  }
  console.warn("沒有辦法產生 HEIC 測試檔（需要 pillow-heif），用到真 HEIC 的測試會略過");
}
