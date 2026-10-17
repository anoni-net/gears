import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { SCENES_MP4, SCENES_WEBM } from "../global-setup.ts";
import { expect, test } from "./guard.ts";

// 影片不進 repo。在頁面裡用 MediaRecorder 錄一段三個場景的影片：紅底白方塊、綠底白圓、
// 藍底白條紋，各約 1.2 秒。MediaRecorder 錄的 WebM 沒有寫長度，也順便測到這種情況
async function recordVideo(page: Page): Promise<{ data: Buffer; mime: string } | null> {
  const result = await page.evaluate(async () => {
    if (typeof MediaRecorder === "undefined") return null;
    const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const g = canvas.getContext("2d")!;
    const draw = (scene: number) => {
      g.fillStyle = ["#c62828", "#2e7d32", "#1565c0"][scene]!;
      g.fillRect(0, 0, 320, 240);
      g.fillStyle = "#fff";
      if (scene === 0) g.fillRect(40, 40, 120, 120);
      if (scene === 1) {
        g.beginPath();
        g.arc(220, 140, 70, 0, Math.PI * 2);
        g.fill();
      }
      if (scene === 2) for (let x = 0; x < 320; x += 40) g.fillRect(x, 0, 20, 240);
    };
    draw(0);
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start(200);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = performance.now() - start;
        if (elapsed > 3600) return resolve();
        draw(Math.min(2, Math.floor(elapsed / 1200)));
        requestAnimationFrame(tick);
      };
      tick();
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mime });
    return { data: Array.from(new Uint8Array(await blob.arrayBuffer())), mime: mime.split(";")[0]! };
  });
  return result ? { data: Buffer.from(result.data), mime: result.mime } : null;
}

// 圖片右上角的顏色：三個場景在那裡分別是紅、綠（圓的外面）、藍（條紋之間）
async function centerColor(page: Page, index: number) {
  return page.getByTestId("frames").locator("img").nth(index).evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const c = document.createElement("canvas");
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const x = c.getContext("2d")!;
    x.drawImage(el, 0, 0);
    return Array.from(x.getImageData(Math.round(c.width * 0.97), Math.round(c.height * 0.03), 1, 1).data.slice(0, 3));
  });
}

// 這個環境的瀏覽器畫得出這段影片的畫面嗎。canPlayType 不可信：Linux 版的 WebKit 少了 GStreamer 的
// 解碼外掛時照樣回報可以，有外掛時也可能跳轉正常、畫到 canvas 卻全是黑的。真的 Safari 沒有這些問題
async function canDraw(page: Page, data: Buffer, mime: string): Promise<boolean> {
  return page.evaluate(
    async ([bytes, type]) => {
      const v = document.createElement("video");
      v.muted = true;
      v.src = URL.createObjectURL(new Blob([new Uint8Array(bytes as number[])], { type: type as string }));
      const timeout = (ms: number) => new Promise<false>((r) => setTimeout(() => r(false), ms));
      const event = (name: string) => new Promise<true>((r) => v.addEventListener(name, () => r(true), { once: true }));
      try {
        if (!(await Promise.race([event("loadeddata"), timeout(10_000)]))) return false;
        const seeked = event("seeked");
        v.currentTime = 0.5;
        if (!(await Promise.race([seeked, timeout(10_000)]))) return false;
        const c = document.createElement("canvas");
        c.width = 8;
        c.height = 8;
        const x = c.getContext("2d")!;
        x.drawImage(v, 0, 0, 8, 8);
        return x.getImageData(0, 0, 8, 8).data.some((value, i) => i % 4 !== 3 && value > 30);
      } finally {
        URL.revokeObjectURL(v.src);
      }
    },
    [Array.from(data), mime] as const,
  );
}

// 打開影片，應該挑出三個場景，第一格紅、最後一格藍。取消勾選第一格，其他的加進暫存區
async function pickAndAdd(page: Page) {
  const status = page.getByTestId("frames-status");
  await expect(status).toContainText(/挑出 \d+ 格/, { timeout: 60_000 });
  const frames = page.getByTestId("frames").locator("li");
  const count = await frames.count();
  expect(count).toBeGreaterThanOrEqual(3);
  expect(count).toBeLessThanOrEqual(16);
  const first = await centerColor(page, 0);
  const last = await centerColor(page, count - 1);
  expect(first[0]).toBeGreaterThan(150);
  expect(first[2]).toBeLessThan(100);
  expect(last[2]).toBeGreaterThan(150);
  expect(last[0]).toBeLessThan(100);

  // 加進暫存區之後，暫存區切到第一張新圖片
  await frames.first().getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: `加進暫存區（${count - 1} 張）` }).click();
  await expect(page.locator(".preview img")).toBeVisible();
  await expect(page.locator("section.tray li").getByText(/^frame-\d+-\d\d\.\d\.jpg$/)).toHaveCount(count - 1);
}

test("H.264 的 MP4：挑出三個場景的畫面，勾選之後加進暫存區", async ({ page }) => {
  test.skip(!existsSync(SCENES_MP4), "沒有測試影片（需要 ffmpeg）");
  await page.goto("./video-frames/");
  const data = readFileSync(SCENES_MP4);
  test.skip(!(await canDraw(page, data, "video/mp4")), "這個環境的瀏覽器畫不出 H.264 的畫面");
  await page.getByTestId("file-input").setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: data });
  await pickAndAdd(page);
});

test("VP8 的 WebM：挑出三個場景的畫面，勾選之後加進暫存區", async ({ page }) => {
  test.skip(!existsSync(SCENES_WEBM), "沒有測試影片（需要 ffmpeg）");
  await page.goto("./video-frames/");
  const data = readFileSync(SCENES_WEBM);
  test.skip(!(await canDraw(page, data, "video/webm")), "這個環境的瀏覽器畫不出 VP8 的畫面");
  await page.getByTestId("file-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: data });
  await pickAndAdd(page);
});

test("MediaRecorder 錄的 WebM（沒有索引，Firefox 跳轉不準，改成播放取樣）", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./video-frames/");
  const video = await recordVideo(page);
  test.skip(!video, "這個瀏覽器沒有 MediaRecorder，錄不了測試影片");
  const ext = video!.mime === "video/mp4" ? "mp4" : "webm";
  await page.getByTestId("file-input").setInputFiles({ name: `clip.${ext}`, mimeType: video!.mime, buffer: video!.data });
  await pickAndAdd(page);
});

test("瀏覽器播放不了的檔案說明原因", async ({ page }) => {
  await page.goto("./video-frames/");
  // 檔頭是 MP4、內容是亂碼
  const broken = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]), Buffer.alloc(4096, 7)]);
  await page.getByTestId("file-input").setInputFiles({ name: "broken.mp4", mimeType: "video/mp4", buffer: broken });
  await expect(page.getByTestId("frames-status")).toContainText("沒有辦法播放這部影片", { timeout: 40_000 });
});
