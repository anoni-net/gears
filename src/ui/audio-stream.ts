import type { Format } from "../core/bytes.ts";
import { LARGE_FILE } from "../core/tool.ts";
import { topBoxes } from "../tools/strip-metadata/mp4.ts";
import { MAX_SECONDS, SAMPLE_RATE } from "../tools/transcribe/segments.ts";
import { type AacTrack, STREAMABLE, aacTrack, mp3Frames, pcmToFloat, wavLayout } from "../tools/transcribe/sources.ts";

// 把錄音分段解碼成 16 kHz 單聲道，每次約 10 分鐘。長錄音不整個讀進記憶體，辨識完一段才
// 解碼下一段，記憶體用量跟錄音長短無關。檔案結構的解析在 src/tools/transcribe/sources.ts。
//
// WAV、MP3 與 MP4、M4A、MOV 裡的 AAC 可以分段，其他格式（瀏覽器不支援 WebCodecs 時的 AAC
// 也是）整個檔案一次解碼，限制在 256 MB 與 2 小時以內。

export const CHUNK_SECONDS = 600;

export class TooLargeError extends Error {}

export interface AudioStream {
  duration: number; // 秒，MP3 是依第一個音訊框估計的
  next(): Promise<Float32Array | null>;
}

const read = async (blob: Blob, start: number, end: number) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

// 每個聲道的取樣換成 16 kHz 單聲道。OfflineAudioContext 的單聲道輸出會把多聲道平均
async function resample(channels: Float32Array[], rate: number): Promise<Float32Array> {
  const length = channels[0]?.length ?? 0;
  if (!length) return new Float32Array();
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.round((length * SAMPLE_RATE) / rate)), SAMPLE_RATE);
  const buffer = ctx.createBuffer(channels.length, length, rate);
  channels.forEach((data, i) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, i));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

// 瀏覽器內建的解碼，解碼時順便換成 16 kHz，再把聲道平均
async function decodeMono(bytes: ArrayBuffer): Promise<Float32Array> {
  const buffer = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i]! += data[i]! / buffer.numberOfChannels;
  }
  return out;
}

// 長度補齊或截短成預期的取樣數，分段之間的時間才不會累積誤差
function fit(audio: Float32Array, samples: number): Float32Array {
  if (audio.length === samples) return audio;
  const out = new Float32Array(samples);
  out.set(audio.subarray(0, samples));
  return out;
}

async function wholeFile(blob: Blob): Promise<AudioStream> {
  if (blob.size > LARGE_FILE) throw new TooLargeError();
  const audio = await decodeMono(await blob.arrayBuffer());
  if (audio.length / SAMPLE_RATE > MAX_SECONDS) throw new TooLargeError();
  let at = 0;
  const step = CHUNK_SECONDS * SAMPLE_RATE;
  return {
    duration: audio.length / SAMPLE_RATE,
    async next() {
      if (at >= audio.length) return null;
      const chunk = audio.slice(at, at + step);
      at += step;
      return chunk;
    },
  };
}

async function wavStream(blob: Blob): Promise<AudioStream | null> {
  const layout = wavLayout(await read(blob, 0, 65536), blob.size);
  if (!layout) return null;
  const frame = (layout.bits / 8) * layout.channels;
  const step = CHUNK_SECONDS * layout.sampleRate * frame;
  const end = layout.dataStart + layout.dataLength;
  let at = layout.dataStart;
  return {
    duration: layout.dataLength / frame / layout.sampleRate,
    async next() {
      if (at >= end) return null;
      const bytes = await read(blob, at, Math.min(end, at + step));
      at += bytes.length;
      return resample(pcmToFloat(bytes, layout), layout.sampleRate);
    },
  };
}

// MP3 的音訊框可能借用前一框的資料（bit reservoir），切點的第一框單獨解碼會壞掉。
// 每一段多帶前兩框一起解碼，再把它們的長度去掉
const MP3_PRIMING = 2;
const MP3_BLOCK = 1 << 20;

async function mp3Stream(blob: Blob): Promise<AudioStream | null> {
  let { frames } = mp3Frames(await read(blob, 0, MP3_BLOCK), 0);
  const first = frames[0];
  if (!first) return null;
  let pos = first.at;
  let prior: { at: number; samples: number; rate: number }[] = [];
  return {
    duration: ((blob.size - first.at) / first.length) * (first.samples / first.rate),
    async next() {
      // 收集約 10 分鐘的音訊框
      const take: typeof frames = [];
      let seconds = 0;
      while (seconds < CHUNK_SECONDS && pos < blob.size) {
        const block = await read(blob, pos, Math.min(blob.size, pos + MP3_BLOCK));
        ({ frames } = mp3Frames(block, pos));
        if (!frames.length) break;
        for (const f of frames) {
          if (seconds >= CHUNK_SECONDS) break;
          take.push(f);
          seconds += f.samples / f.rate;
          pos = f.at + f.length;
        }
      }
      if (!take.length) return null;
      const priming = prior.slice(-MP3_PRIMING);
      const start = priming[0]?.at ?? take[0]!.at;
      const last = take.at(-1)!;
      const audio = await decodeMono((await read(blob, start, last.at + last.length)).buffer as ArrayBuffer);
      prior = take.slice(-MP3_PRIMING);
      const skip = Math.round(priming.reduce((s, f) => s + (f.samples / f.rate) * SAMPLE_RATE, 0));
      return fit(audio.subarray(skip), Math.round(seconds * SAMPLE_RATE));
    },
  };
}

// MP4 的 moov 通常幾 MB，超過這個大小不讀
const MAX_MOOV = 128 * 1024 * 1024;

async function aacStream(blob: Blob): Promise<AudioStream | null> {
  if (typeof AudioDecoder === "undefined") return null;
  const moov = (await topBoxes(blob)).find((b) => b.type === "moov");
  if (!moov || moov.end - moov.start > MAX_MOOV) return null;
  const track: AacTrack | null = aacTrack(await read(blob, moov.start, moov.end));
  if (!track || !track.samples.length) return null;
  const config = { codec: track.codec, sampleRate: track.sampleRate, numberOfChannels: track.channels, description: track.config };
  if (!(await AudioDecoder.isConfigSupported(config)).supported) return null;

  let index = 0;
  return {
    duration: track.duration,
    async next() {
      if (index >= track.samples.length) return null;
      const from = track.samples[index]!.time;
      let end = index;
      while (end < track.samples.length && track.samples[end]!.time < from + CHUNK_SECONDS) end++;
      // AAC 的每一框跟前一框有重疊，多帶前一框一起解碼，輸出時依時間去掉
      const prime = Math.max(0, index - 1);
      const planes: Float32Array[][] = [];
      let rate = track.sampleRate;
      const decoder = new AudioDecoder({
        output(data) {
          if (data.timestamp >= from * 1e6 - 1000) {
            rate = data.sampleRate;
            const frame: Float32Array[] = [];
            for (let c = 0; c < data.numberOfChannels; c++) {
              const plane = new Float32Array(data.numberOfFrames);
              data.copyTo(plane, { planeIndex: c, format: "f32-planar" });
              frame.push(plane);
            }
            planes.push(frame);
          }
          data.close();
        },
        error() {},
      });
      decoder.configure(config);
      // 連續的樣本合成一次讀取，影片裡的聲音跟影像交錯，不能整段一起讀
      let i = prime;
      while (i < end) {
        let j = i + 1;
        while (j < end && track.samples[j]!.at === track.samples[j - 1]!.at + track.samples[j - 1]!.size) j++;
        const s = track.samples[i]!;
        const bytes = await read(blob, s.at, track.samples[j - 1]!.at + track.samples[j - 1]!.size);
        for (let k = i; k < j; k++) {
          const sample = track.samples[k]!;
          decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round(sample.time * 1e6), data: bytes.subarray(sample.at - s.at, sample.at - s.at + sample.size) }));
        }
        i = j;
      }
      await decoder.flush();
      decoder.close();
      index = end;
      const channels = Math.max(1, ...planes.map((p) => p.length));
      const joined = Array.from({ length: channels }, (_, c) => {
        const out = new Float32Array(planes.reduce((n, p) => n + (p[c] ?? p[0]!).length, 0));
        let at = 0;
        for (const p of planes) {
          out.set(p[c] ?? p[0]!, at);
          at += (p[c] ?? p[0]!).length;
        }
        return out;
      });
      const seconds = (track.samples[end]?.time ?? track.duration) - from;
      return fit(await resample(joined, rate), Math.round(seconds * SAMPLE_RATE));
    },
  };
}

// 依格式挑分段的方式，分不了段的整個檔案解碼
export async function openAudio(blob: Blob, format: Format): Promise<AudioStream> {
  const stream =
    format === "wav" ? await wavStream(blob) : format === "mp3" ? await mp3Stream(blob) : STREAMABLE.includes(format) ? await aacStream(blob).catch(() => null) : null;
  return stream ?? wholeFile(blob);
}
