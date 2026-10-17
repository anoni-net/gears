// 從影片擷取關鍵影格（挑選的邏輯在 src/tools/video-frames/）。
//
// 用瀏覽器的 <video> 解碼：跳到每個取樣的時間點，畫成 32 × 32 的灰階小圖比對畫面有沒有換，
// 挑出來的時間點再畫成原尺寸、編碼成 JPEG。影片從 Blob 的網址讀，幾 GB 的檔案也不必整個
// 讀進記憶體。重新編碼的 JPEG 不帶任何中繼資料。
//
// 要讀 canvas 的像素，Tor Browser 這類瀏覽器要讀者允許（canvas-access.ts），呼叫的人先檢查。

import { SIZE, type Sample, difference, pickFrames, sampleTimes } from "../tools/video-frames/index.ts";

// 輸出的長邊上限。4K 影片的畫面拿去搜尋用不到那麼大，檔案也太大
const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.9;
// 單一次跳轉超過這個時間就當成解不開，有些格式只能播放、不能跳轉
const SEEK_TIMEOUT = 10_000;

export interface Frame {
  time: number;
  blob: Blob;
  width: number;
  height: number;
}

export class VideoUnplayableError extends Error {
  constructor() {
    super("video-unplayable");
  }
}

function once(video: HTMLVideoElement, event: string, timeout = SEEK_TIMEOUT): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new VideoUnplayableError()), timeout);
    const ok = () => finish();
    const fail = () => finish(new VideoUnplayableError());
    function finish(error?: Error) {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener("error", fail);
      if (error) reject(error);
      else resolve();
    }
    video.addEventListener(event, ok);
    video.addEventListener("error", fail);
  });
}

async function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return;
  const done = once(video, "seeked");
  video.currentTime = time;
  await done;
}

// 開啟影片，回傳 <video> 與長度。MediaRecorder 錄的 WebM 常沒有寫長度（Infinity），
// 跳到很後面讓瀏覽器自己算出來
export async function openVideo(blob: Blob): Promise<{ video: HTMLVideoElement; duration: number; close(): void }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Safari 不在畫面上的 <video> 有時不解碼，放進頁面但移到畫面外（styles.css 的 .offscreen-video）
  video.className = "offscreen-video";
  document.body.append(video);
  const close = () => {
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };
  try {
    const loaded = once(video, "loadeddata", 30_000);
    video.src = url;
    await loaded;
    if (!video.videoWidth || !video.videoHeight) throw new VideoUnplayableError();
    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      await seek(video, 1e7);
      duration = video.duration;
      await seek(video, 0);
    }
    return { video, duration: Number.isFinite(duration) ? duration : 0, close };
  } catch (error) {
    close();
    throw error instanceof VideoUnplayableError ? error : new VideoUnplayableError();
  }
}

// 播放取樣的上限：跳轉不準的檔案改成從頭播放，以 16 倍速計，30 分鐘的影片約兩分鐘
const PLAYBACK_LIMIT = 30 * 60;
// 播放時超過這個時間都沒有前進，就當成卡住了
const STALL = 15_000;

export type Progress = { step: "scan"; ratio: number } | { step: "capture"; done: number; total: number };

function lumaOf(ctx: CanvasRenderingContext2D, video: HTMLVideoElement): Uint8Array {
  ctx.drawImage(video, 0, 0, SIZE, SIZE);
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const luma = new Uint8Array(SIZE * SIZE);
  for (let p = 0; p < luma.length; p++) luma[p] = (rgba[p * 4]! * 299 + rgba[p * 4 + 1]! * 587 + rgba[p * 4 + 2]! * 114) / 1000;
  return luma;
}

// 目前的畫面畫成長邊不超過 MAX_EDGE 的 canvas
function drawFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function toFrame(time: number, canvas: HTMLCanvasElement): Promise<Frame> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  const { width, height } = canvas;
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("encode");
  return { time, blob, width, height };
}

const aborted = () => new DOMException("aborted", "AbortError");

// 從頭播放，影片的時間經過每個時間點時呼叫 onTime（當下的畫面就是那個時間點）。
// 片尾之後還沒輪到的時間點用最後一格
async function playThrough(video: HTMLVideoElement, times: number[], onTime: (time: number) => void, signal?: AbortSignal) {
  await seek(video, 0);
  video.playbackRate = 16;
  let i = 0;
  await new Promise<void>((resolve, reject) => {
    let stopped = false;
    let last = Date.now();
    const finish = (error?: unknown) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      video.removeEventListener("ended", ended);
      video.pause();
      video.playbackRate = 1;
      if (error) reject(error);
      else resolve();
    };
    const check = (mediaTime: number) => {
      if (signal?.aborted) return finish(aborted());
      while (i < times.length && mediaTime >= times[i]!) {
        onTime(times[i]!);
        i++;
        last = Date.now();
      }
      if (i >= times.length) finish();
    };
    const ended = () => {
      while (i < times.length) onTime(times[i++]!);
      finish();
    };
    video.addEventListener("ended", ended);
    // requestVideoFrameCallback：Safari 15.4、Firefox 132 起才有，沒有時每 30 毫秒看一次時間
    const withCallback = typeof video.requestVideoFrameCallback === "function";
    const loop = (_now: number, meta: { mediaTime: number }) => {
      check(meta.mediaTime);
      if (!stopped) video.requestVideoFrameCallback(loop);
    };
    if (withCallback) video.requestVideoFrameCallback(loop);
    const timer = setInterval(() => {
      if (!withCallback) check(video.currentTime);
      if (Date.now() - last > STALL) finish(new VideoUnplayableError());
    }, withCallback ? 1000 : 30);
    video.play().catch(finish);
  });
}

// 掃過整部影片，挑出畫面明顯不同的幾格並擷取成 JPEG。
//
// 先用跳轉取樣，快，長片也只要跳 240 次。MediaRecorder 錄的 WebM（瀏覽器的螢幕錄影常是這種）
// 沒有索引，Firefox 跳轉之後畫面不會更新，取樣到的全是第一格。取樣的畫面幾乎都一樣時，改成
// 從頭播放、依序取樣。畫面真的不動的影片也會走到這裡，所以只在 30 分鐘以內的影片這樣做
export async function extractFrames(video: HTMLVideoElement, duration: number, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<Frame[]> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const times = sampleTimes(duration);

  let samples: Sample[] = [];
  for (const [i, time] of times.entries()) {
    if (signal?.aborted) throw aborted();
    await seek(video, time);
    samples.push({ time, luma: lumaOf(ctx, video) });
    onProgress({ step: "scan", ratio: (i + 1) / times.length });
  }
  const seekWorks = samples.length < 3 || samples.some((s) => difference(samples[0]!.luma, s.luma) >= 2);
  const playback = !seekWorks && duration >= 2 && duration <= PLAYBACK_LIMIT;
  if (playback) {
    samples = [];
    onProgress({ step: "scan", ratio: 0 });
    await playThrough(video, times, (time) => {
      samples.push({ time, luma: lumaOf(ctx, video) });
      onProgress({ step: "scan", ratio: samples.length / times.length });
    }, signal);
  }

  const picked = pickFrames(samples);
  const frames: Frame[] = [];
  if (playback) {
    const drawn: { time: number; canvas: HTMLCanvasElement }[] = [];
    await playThrough(video, picked, (time) => {
      drawn.push({ time, canvas: drawFrame(video) });
      onProgress({ step: "capture", done: drawn.length, total: picked.length });
    }, signal);
    for (const d of drawn) frames.push(await toFrame(d.time, d.canvas));
  } else {
    for (const [i, time] of picked.entries()) {
      if (signal?.aborted) throw aborted();
      onProgress({ step: "capture", done: i + 1, total: picked.length });
      await seek(video, time);
      frames.push(await toFrame(time, drawFrame(video)));
    }
  }
  return frames;
}
