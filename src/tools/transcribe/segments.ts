import models from "./models.json" with { type: "json" };

// 逐字稿的純邏輯：模型清單、辨識結果的整理、TXT 與 SRT 的輸出。模型的執行在
// src/ui/transcribe.worker.ts，這裡只有文字與數字的處理，可以在 Node 裡測試。

export type ModelId = keyof typeof models;
export const MODEL_IDS = Object.keys(models) as ModelId[];
export const MODELS = models;

export const SAMPLE_RATE = 16000;
// 解碼成 16 kHz 單聲道之後，一小時約 230 MB。超過兩小時的錄音記憶體容易不夠，先不處理
export const MAX_SECONDS = 2 * 60 * 60;

// Whisper 一次最多看 30 秒
export const PIECE_SECONDS = 30;

// 語音偵測：只把有人說話的片段交給 Whisper。Whisper 在靜音上會產生重複的幻覺文字
// （實測 base 對 5 秒的靜音輸出「你懂你懂你懂……」直到長度上限，瀏覽器裡要好幾分鐘），
// 會議錄音常有長時間的安靜，跳過也省時間。
//
// 用音量判斷：每 30 毫秒算一次音量，雜訊的基準取最安靜的一成，高於基準三倍（至少 0.006，
// 最多是最大聲那一成的三成）算有聲音。停頓不到 0.8 秒的視為同一段，前後各留 0.2 秒。說話的段落依序裝進不超過
// 30 秒的片段，一段話本身超過 30 秒時，在 20 到 30 秒之間最安靜的地方切開，盡量不切斷字
const FRAME = Math.round(0.03 * SAMPLE_RATE);
const MIN_LEVEL = 0.006;
const JOIN_GAP = 0.8;
const PAD = 0.2;

// 每個片段最多產生的詞元數。華語說得再快每秒約 9 個詞元（含時間標記），抓每秒 15 個留餘裕，
// 模型卡在重複的迴圈裡時不會一路產生到上限（448 個）
export const maxTokens = (samples: number) => Math.min(440, Math.ceil((samples / SAMPLE_RATE) * 15) + 20);

export interface Piece {
  start: number; // 取樣點
  end: number;
}

export function speechPieces(audio: Float32Array): Piece[] {
  const frames = Math.floor(audio.length / FRAME);
  if (!frames) return [];
  const level = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) sum += audio[i]! * audio[i]!;
    level[f] = Math.sqrt(sum / FRAME);
  }
  const sorted = [...level].sort((a, b) => a - b);
  const floor = sorted[Math.floor(frames * 0.1)]!;
  const loud = sorted[Math.floor(frames * 0.9)]!;
  // 整段都在說話時，最安靜的一成也很大聲，門檻不超過最大聲那一成的三成
  const threshold = Math.max(MIN_LEVEL, Math.min(floor * 3, loud * 0.3));

  // 有聲音的範圍，停頓太短的接起來
  const regions: Piece[] = [];
  const gap = Math.round((JOIN_GAP * SAMPLE_RATE) / FRAME);
  for (let f = 0; f < frames; f++) {
    if (level[f]! < threshold) continue;
    const last = regions.at(-1);
    if (last && f - last.end <= gap) last.end = f + 1;
    else regions.push({ start: f, end: f + 1 });
  }
  const pad = Math.round((PAD * SAMPLE_RATE) / FRAME);
  const max = Math.round((PIECE_SECONDS * SAMPLE_RATE) / FRAME);
  const min = Math.round((20 * SAMPLE_RATE) / FRAME);

  // 依序裝進不超過 30 秒的片段，片段裡保留原本的停頓，時間才對得上
  const pieces: Piece[] = [];
  for (const region of regions) {
    let start = Math.max(0, region.start - pad);
    const end = Math.min(frames, region.end + pad);
    const last = pieces.at(-1);
    // Whisper 不管片段多短都補到 30 秒再算，裝得進同一個片段就不另開，片段越少越快
    if (last && end - last.start <= max) {
      last.end = end;
      continue;
    }
    if (last && start < last.end) start = last.end;
    while (end - start > max) {
      let cut = start + min;
      for (let f = start + min; f < start + max; f++) if (level[f]! < level[cut]!) cut = f;
      pieces.push({ start, end: cut });
      start = cut;
    }
    if (end > start) pieces.push({ start, end });
  }
  // 結束在最後一個音框的片段延伸到錄音的結尾，不足一個音框的尾巴才不會漏掉
  return pieces.map((p) => ({ start: p.start * FRAME, end: p.end >= frames ? audio.length : p.end * FRAME }));
}

export interface Segment {
  start: number; // 秒
  end: number;
  text: string;
  speaker?: number; // 分辨說話者時才有，0 是最先開口的人（src/tools/transcribe/speakers.ts）
}

export interface RawChunk {
  text: string;
  timestamp: [number, number | null];
}

// 平均音量低於這個值的段落當成靜音。Whisper 在靜音的地方常會冒出「字幕由…提供」、
// 「請不吝點讚訂閱」這類訓練資料裡的字幕標語
const SILENCE_RMS = 0.004;

function rms(audio: Float32Array, start: number, end: number): number {
  const from = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const to = Math.min(audio.length, Math.ceil(end * SAMPLE_RATE));
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += audio[i]! * audio[i]!;
  return Math.sqrt(sum / (to - from));
}

// Whisper 的訓練資料裡有大量影片字幕，在音樂、音調或聽不清楚的地方常會冒出字幕的標語。
// 整段很短又是這類標語的拿掉，長的段落可能是真的在說這些話，留著
const CAPTION_CREDITS = /字幕|請不吝|點贊|點讚|訂閱|轉發|打賞|明鏡|點點欄目|Amara|優優獨播|YoYo|謝謝觀看|感謝觀看/i;
const isCaptionCredit = (text: string) => text.length <= 30 && CAPTION_CREDITS.test(text);

// 同一句話連續重複四次以上，收成一次。小模型偶爾會卡在重複的迴圈裡
export function collapseRepeats(text: string): string {
  return text.replace(/(.{2,40}?)(?:\s*\1){3,}/gu, "$1");
}

const normalize = (text: string) => text.replace(/[\s\p{P}]/gu, "");

// Whisper 在中文句子裡常用半形的逗號與問號，中文字旁邊的半形標點換成全形，英文與數字裡的不動
const FULL_WIDTH: Record<string, string> = { ",": "，", "?": "？", "!": "！", ":": "：", ";": "；" };
const HAN = "\\p{Script=Han}";
export const fullWidthPunctuation = (text: string) =>
  text.replace(new RegExp(`(?<=${HAN})\\s*([,?!:;])\\s*|\\s*([,?!:;])\\s*(?=${HAN})`, "gu"), (_, a: string, b: string) => FULL_WIDTH[a ?? b]!);

// 整理模型的輸出：去掉空白段落、靜音段落與字幕標語，收掉重複的迴圈，前後一樣的段落合併。
// 最後一段沒有結束時間時，用錄音的長度
// audio 是這一段的聲音，從 offset 秒開始（長錄音分段處理，時間是整份錄音的時間）
// chinese 是錄音的語言是否為華語，是才把半形標點換成全形
export function cleanSegments(chunks: RawChunk[], audio: Float32Array, offset = 0, chinese = true): Segment[] {
  const duration = offset + audio.length / SAMPLE_RATE;
  const out: Segment[] = [];
  chunks.forEach((chunk, i) => {
    const repeated = collapseRepeats(chunk.text.trim());
    const text = chinese ? fullWidthPunctuation(repeated) : repeated;
    if (!normalize(text) || isCaptionCredit(text)) return;
    const start = chunk.timestamp[0];
    const end = chunk.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? duration;
    if (rms(audio, start - offset, end - offset) < SILENCE_RMS) return;
    const prev = out.at(-1);
    if (prev && normalize(prev.text) === normalize(text)) {
      prev.end = Math.max(prev.end, end);
      return;
    }
    out.push({ start, end: Math.max(end, start), text });
  });
  return out;
}

// 分段處理時，前一段的最後一句與下一段的第一句可能一樣，合併
export function mergeSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const prev = out.at(-1);
    if (prev && normalize(prev.text) === normalize(seg.text) && seg.start - prev.end < 2) prev.end = Math.max(prev.end, seg.end);
    else out.push({ ...seg });
  }
  return out;
}

// 1:02:03、02:03 這種顯示用的時間
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// SRT 的時間：00:01:02,345
function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

// name 把說話者編號換成「說話者 1：」這類前綴（標點依語系），有分辨說話者時加在每段前面
type SpeakerName = (speaker: number) => string;
const withSpeaker = (seg: Segment, name?: SpeakerName) => (name && seg.speaker !== undefined ? `${name(seg.speaker)}${seg.text}` : seg.text);

export function toSrt(segments: Segment[], name?: SpeakerName): string {
  return segments.map((seg, i) => `${i + 1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${withSpeaker(seg, name)}\n`).join("\n");
}

// 純文字：每段一行，前面加上時間，方便對照錄音校對
export function toTxt(segments: Segment[], name?: SpeakerName): string {
  return segments.map((seg) => `[${clock(seg.start)}] ${withSpeaker(seg, name)}`).join("\n") + "\n";
}
