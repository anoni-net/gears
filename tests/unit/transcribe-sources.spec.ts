import { expect, test } from "@playwright/test";
import { mergeSegments } from "../../src/tools/transcribe/segments.ts";
import { aacTrack, mp3Frames, pcmToFloat, wavLayout } from "../../src/tools/transcribe/sources.ts";
import { wav } from "../helpers/audio.ts";
import { mp3Frames as frames } from "../helpers/media.ts";

const u32 = (n: number) => new Uint8Array([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const u16 = (n: number) => new Uint8Array([n >> 8, n & 255]);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const box = (type: string, ...payload: Uint8Array[]) => {
  const body = join(...payload);
  return join(u32(8 + body.length), new TextEncoder().encode(type), body);
};
const full = (type: string, ...payload: Uint8Array[]) => box(type, new Uint8Array(4), ...payload);

test("WAV：16 位元單聲道，讀出取樣率與資料的位置", () => {
  const file = wav(2, 16000, () => 0.5);
  expect(wavLayout(file, file.length)).toEqual({ sampleRate: 16000, channels: 1, bits: 16, float: false, dataStart: 44, dataLength: 64000 });
  const [samples] = pcmToFloat(file.subarray(44, 48), wavLayout(file, file.length)!);
  expect([...samples!]).toEqual([0.499969482421875, 0.499969482421875]);
});

test("WAV：錄到一半斷掉、data 長度寫成 0 的檔案，依檔案大小推算", () => {
  const file = wav(1);
  file.set([0, 0, 0, 0], 40);
  expect(wavLayout(file, file.length)!.dataLength).toBe(32000);
});

test("WAV：24 位元雙聲道與 8 位元的取樣換成浮點數", () => {
  const layout = { sampleRate: 48000, channels: 2, bits: 24, float: false, dataStart: 0, dataLength: 6 };
  const [left, right] = pcmToFloat(new Uint8Array([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]), layout);
  expect(left![0]).toBe(0.5);
  expect(right![0]).toBe(-0.5);
  const [eight] = pcmToFloat(new Uint8Array([0, 128, 255]), { ...layout, bits: 8, channels: 1 });
  expect([...eight!]).toEqual([-1, 0, 127 / 128]);
});

test("WAV：不是 PCM 的格式（例如 ADPCM）不分段", () => {
  const file = wav(1);
  file.set([2, 0], 20);
  expect(wavLayout(file, file.length)).toBeNull();
});

test("MP3：連續讀音訊框，不完整的最後一框留給下一次", () => {
  const data = frames(5);
  const { frames: found, next } = mp3Frames(data.subarray(0, 417 * 4 + 100), 0);
  expect(found.map((f) => f.at)).toEqual([0, 417, 834, 1251]);
  expect(found[0]).toMatchObject({ length: 417, samples: 1152, rate: 44100 });
  expect(next).toBe(417 * 4);
  // 從檔案的第 1668 個位元組接著讀
  expect(mp3Frames(data.subarray(1668), 1668).frames.map((f) => f.at)).toEqual([1668]);
});

test("MP3：音訊框之間夾著雜訊時，往後找下一個同步字", () => {
  const data = join(frames(1), new Uint8Array([1, 2, 3, 4, 5]), frames(2));
  expect(mp3Frames(data, 0).frames.map((f) => f.at)).toEqual([0, 422, 839]);
});

// 一條 AAC 聲音軌：44.1 kHz、雙聲道，3 個樣本分在兩個 chunk
function aacMoov(sampleEntryVersion = 0) {
  const asc = new Uint8Array([0x12, 0x10]); // AAC-LC、44.1 kHz、雙聲道
  const dsi = join(new Uint8Array([5, asc.length]), asc);
  const dc = join(new Uint8Array([4, 13 + dsi.length, 0x40, 0x15]), new Uint8Array(11), dsi);
  const es = join(new Uint8Array([3, 3 + dc.length, 0, 1, 0]), dc);
  const esds = full("esds", es);
  const extra = new Uint8Array(sampleEntryVersion === 1 ? 16 : 0);
  const mp4a = box("mp4a", new Uint8Array(6), u16(1), u16(sampleEntryVersion), new Uint8Array(6), u16(2), u16(16), new Uint8Array(4), u32(44100 << 16 >>> 0), extra, esds);
  const stbl = box(
    "stbl",
    full("stsd", u32(1), mp4a),
    full("stts", u32(1), u32(3), u32(1024)),
    full("stsc", u32(2), u32(1), u32(2), u32(1), u32(2), u32(1), u32(1)),
    full("stsz", u32(0), u32(3), u32(100), u32(120), u32(90)),
    full("stco", u32(2), u32(1000), u32(5000)),
  );
  const mdhd = full("mdhd", u32(0), u32(0), u32(44100), u32(3072), new Uint8Array(4));
  const hdlr = full("hdlr", u32(0), new TextEncoder().encode("soun"), new Uint8Array(12));
  return box("moov", box("trak", box("mdia", mdhd, hdlr, box("minf", stbl))));
}

test("MP4：找出 AAC 聲音軌的設定、每個樣本的位置與時間", () => {
  const track = aacTrack(aacMoov())!;
  expect(track).toMatchObject({ codec: "mp4a.40.2", sampleRate: 44100, channels: 2, timescale: 44100 });
  expect([...track.config]).toEqual([0x12, 0x10]);
  expect(track.duration).toBeCloseTo(3072 / 44100);
  expect(track.samples).toEqual([
    { at: 1000, size: 100, time: 0 },
    { at: 1100, size: 120, time: 1024 / 44100 },
    { at: 5000, size: 90, time: 2048 / 44100 },
  ]);
});

test("MOV：QuickTime 版本 1 的 sound description 一樣讀得到", () => {
  expect(aacTrack(aacMoov(1))?.codec).toBe("mp4a.40.2");
});

test("分段處理時，接縫上重複的那一句合併", () => {
  expect(
    mergeSegments([
      { start: 595, end: 599, text: "我們接著談" },
      { start: 599.5, end: 601, text: "我們接著談。" },
      { start: 602, end: 604, text: "下一個題目" },
    ]),
  ).toEqual([
    { start: 595, end: 601, text: "我們接著談" },
    { start: 602, end: 604, text: "下一個題目" },
  ]);
});
