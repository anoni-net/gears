import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { encodeQr, qrPng } from "../src/tools/qrcode/index.ts";
import { fetchC2paFixtures } from "./helpers/c2pa-fixtures.ts";

export const GENERATED = "tests/.generated";
export const QR_TEXT = "https://anoni.net/gears/";

// 瀏覽器測試開始前產生真的圖片（HEIC、WebP、AVIF、GIF、TIFF）。libheif 不附 HEVC 編碼器，
// 只能用 pillow-heif 產生。有 uv 就用 uv，沒有就用系統的 python3。產生不了時，用到這些檔案的測試會略過。
// 關鍵影格的測試影片：紅、綠、藍三個場景各 1.2 秒。H.264 的 MP4 是 iPhone 拍的影片多半用的格式，
// Linux 版的 WebKit 解不開 H.264，另外產生一份 VP8 的 WebM。有 ffmpeg 才產生（GitHub 的 ubuntu
// 機器有），沒有時用到的測試會略過
export const SCENES_MP4 = `${GENERATED}/scenes.mp4`;
export const SCENES_WEBM = `${GENERATED}/scenes.webm`;

function makeVideo() {
  if (existsSync(SCENES_MP4) && existsSync(SCENES_WEBM)) return;
  const scene = (color: string) => ["-f", "lavfi", "-i", `color=c=${color}:s=320x240:d=1.2:r=15`];
  try {
    execFileSync(
      "ffmpeg",
      [
        "-loglevel", "error", "-y",
        ...scene("0xc62828"), ...scene("0x2e7d32"), ...scene("0x1565c0"),
        "-filter_complex",
        // 每個場景加一塊白色，畫面才不是單一顏色
        "[0]drawbox=x=40:y=40:w=120:h=120:c=white:t=fill[a];[1]drawbox=x=160:y=80:w=120:h=120:c=white:t=fill[b];[2]drawbox=x=0:y=0:w=20:h=240:c=white:t=fill[c];[a][b][c]concat=n=3:v=1,split=2[v1][v2]",
        "-map", "[v1]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "15", "-movflags", "+faststart", SCENES_MP4,
        "-map", "[v2]", "-c:v", "libvpx", "-b:v", "500k", "-g", "15", SCENES_WEBM,
      ],
      { stdio: "pipe", timeout: 60_000 },
    );
  } catch {
    // 失敗時 ffmpeg 可能留下空的檔案，下次就會以為已經產生過
    rmSync(SCENES_MP4, { force: true });
    rmSync(SCENES_WEBM, { force: true });
    console.warn("沒有辦法產生測試影片（需要 ffmpeg），用到的測試會略過");
  }
}

// PAdES 長期驗證的 PDF（#128）：用 pyHanko 簽署、加上時間戳記與 /DSS，看查證怎麼讀它實際寫出的結構。
// 需要 uv，沒有時用到的測試會略過
export const PADES = { lt: `${GENERATED}/pades-lt.pdf`, lta: `${GENERATED}/pades-lta.pdf`, root: `${GENERATED}/pades-root.der` };

function makePades() {
  if (existsSync(PADES.lt) && existsSync(PADES.lta)) return;
  try {
    execFileSync("uv", ["run", "--quiet", "--with", "pyhanko==0.29.0", "python", "scripts/make-test-pades.py", GENERATED], { stdio: "pipe", timeout: 120_000 });
  } catch {
    console.warn("沒有辦法產生 PAdES 的測試檔（需要 uv 與 pyHanko），用到的測試會略過");
  }
}

export default async function globalSetup() {
  mkdirSync(GENERATED, { recursive: true });
  makeVideo();
  makePades();
  await fetchC2paFixtures();
  const qr = `${GENERATED}/qr.png`;
  writeFileSync(qr, qrPng(encodeQr(QR_TEXT, "M"), 8));
  const script = "scripts/make-test-images.py";
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
  console.warn("沒有辦法產生測試圖片（需要 pillow-heif），用到這些檔案的測試會略過");
}
