import { expect, test } from "@playwright/test";
import { ORIENTATIONS, distance, fromHex, hex, pdqFromRGBA } from "../../src/tools/verify/pdq.ts";

// PDQ 的 JavaScript 移植（src/tools/verify/pdq.ts）跟 meta/ThreatExchange 9f627fb1 的 C++ 參考實作比對。
// 圖片用整數公式產生，不放照片：同一個公式用 Pillow 寫成 PNG，交給參考實作的 pdq-photo-hasher --pdqdih-across
// 算出 8 個方向的雜湊與品質，記在下面（2026-11-22，做法見社群工作區的 research/gears-similar/）。
// 同一組 RGB 位元組要算出完全相同的雜湊與品質，這是 PDQ README「正確」的第一個條件。
// 第二個條件（瀏覽器用 canvas 解碼、品質 80 以上時差 10 以內）在評測裡量過，瀏覽器測試只看分組的結果。

type Kind = "xor" | "rings" | "blocks" | "flat";

function pixel(kind: Kind, x: number, y: number, w: number, h: number): [number, number, number] {
  if (kind === "xor") return [(x ^ y) & 255, (x * 3 + y * 5) & 255, ((x * y) >> 3) & 255];
  if (kind === "rings") {
    const d = ((x - Math.floor(w / 3)) ** 2 + (y - Math.floor(h / 2)) ** 2) >> 6;
    return [(d * 13) & 255, Math.floor((x * 255) / w), Math.floor((y * 255) / h)];
  }
  if (kind === "blocks") return [(((x >> 4) + (y >> 4)) & 1) * 200 + (x & 31), Math.floor((y * 255) / h), (x * 7 + y) & 127];
  return [128 + ((x + y) & 1), 128, 128];
}

function rgb(kind: Kind, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out.set(pixel(kind, x, y, w, h), (y * w + x) * 3);
  return out;
}

// pdq-photo-hasher --pdqdih-across 的輸出：8 個方向（orig、rot90、rot180、rot270、flipX、flipY、flipPlus1、flipMinus1）與品質
const REF: { kind: Kind; w: number; h: number; quality: number; hashes: string[] }[] = [
  {
    kind: "xor",
    w: 64,
    h: 64,
    quality: 100,
    hashes: [
      "01ffbf01aa558ad5b780403bd7e0444ad95a77b188a7afec8881bb3bddde4444",
      "7abaf87c6854b53970bab4ac7a5435399a7a4c6c86744b3985964fcc85a60b93",
      "54aa05abff00207fe2d5ea9182b5eee0840f9d1bddf20446ddd49991888beeee",
      "2feb52163d011f93256b1e062f019f93cd2fe6c6d321e193d0c3e566d0f3a139",
      "01ff40feaa55752ab780bfc4d760bbb5915a884e88a75113888144c4dddebbbb",
      "54aaea54ff00df80e2d5156e82b5111f8c0f62e4ddf2fbb9ddd4666e888b1111",
      "7abe07c368544ac670be4b537a54cad69a7ab3938674b4c68596b03385a6f46c",
      "2fefad293d01a06c256fe1f92f01606ccf2f1939d3211e6cd0c31a99d0f35ec6",
    ],
  },
  {
    kind: "rings",
    w: 200,
    h: 120,
    quality: 100,
    hashes: [
      "ec719c71e7f1e471638ee561190e000efc719c75e371d6911b8e1a95ec711c71",
      "f4f6434dfcb2bd22c2df4b2d2c3cd1d7295d0b1cf4f30f480b48f4b30f480b0c",
      "b92416dbb2a44edb36d94fc94c5baa24a9243645b624741b4edbb03eb924b2db",
      "a1a7e9e7a9f71688978aa0827d697b7d7d09a1a6a1a6a1a25e1d1e195e1da1a2",
      "ec71438ae7f11b8e638e1a8e190eebf1fc716300e371210e1b8ee16aec71e38e",
      "b924ed24b2a4b12436dbb2364c5b55dba924c9bab624abe44edbcfc1b9244da4",
      "f4f2bcb2bca242ddc2cff4d3283c2e28281cf4e3f4e3f0f70b080b4c0b08f4f7",
      "a1a71618a9f7e877978a5e787d6984827c095e49a1a65a1d5e1da1e6521d5e59",
    ],
  },
  {
    // 超過 512 像素：照參考實作先用最近鄰縮成 512 × 512
    kind: "blocks",
    w: 600,
    h: 400,
    quality: 100,
    hashes: [
      "8400575784005d57840dfff984047ffd8404555d8000ffff868e7fff84007fff",
      "aabaeeba0515afba0115bbba0515eafa0415feba0515baba0555a5735014a7fa",
      "d555beadd555fbadd5508912d551c152d151feb2d5550000d551d555d555d153",
      "ffef5551555055515550ffdf55695551554955515148555158484fd905595dd9",
      "8400fffd8400fff9840dffd78404fff78405ffff82007d5786af84008400d7d7",
      "d5554142d5550452d55072edd5513e2dd551010dd555ffffd5512aaad5552aac",
      "aeba5555051555551515ffdf451d5555051d5555051555550d5d5bdd501d5d55",
      "ffefbbef5040faef5440ea6e5040bfaf5040abaf5040afef5000f0260541f2af",
    ],
  },
];

for (const ref of REF) {
  test(`PDQ：${ref.kind} ${ref.w}×${ref.h} 跟 C++ 參考實作的 8 個方向與品質完全相同`, () => {
    const out = pdqFromRGBA(rgb(ref.kind, ref.w, ref.h), ref.w, ref.h, { channels: 3 });
    expect(out.quality).toBe(ref.quality);
    expect(hex(out.hash)).toBe(ref.hashes[0]);
    expect(Object.fromEntries(ORIENTATIONS.map((name, i) => [name, hex(out.dihedral[i]!)]))).toEqual(Object.fromEntries(ORIENTATIONS.map((name, i) => [name, ref.hashes[i]])));
  });
}

test("PDQ：幾乎沒有紋路的圖品質是 0（參考實作也是 0），比對時不採用", () => {
  const out = pdqFromRGBA(rgb("flat", 80, 80), 80, 80, { channels: 3 });
  expect(out.quality).toBe(0);
});

test("PDQ：canvas 的 RGBA 跟 RGB 算出同一個雜湊", () => {
  const w = 200;
  const h = 120;
  const src = rgb("rings", w, h);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([src[i * 3]!, src[i * 3 + 1]!, src[i * 3 + 2]!, 255], i * 4);
  expect(hex(pdqFromRGBA(rgba, w, h).hash)).toBe(REF[1]!.hashes[0]);
});

test("PDQ：翻轉、轉 90 度的像素，原本的雜湊跟原圖對應的方向一樣", () => {
  // 64 × 64 不經過 Jarosz 濾波，像素換位置等同 DCT 係數換號與轉置
  const n = 64;
  const src = rgb("xor", n, n);
  const at = (x: number, y: number) => src.subarray((y * n + x) * 3, (y * n + x) * 3 + 3);
  const make = (map: (x: number, y: number) => [number, number]) => {
    const out = new Uint8Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.set(at(...map(x, y)), (y * n + x) * 3);
    return pdqFromRGBA(out, n, n, { channels: 3 }).hash;
  };
  const orig = pdqFromRGBA(src, n, n, { channels: 3 });
  const dist = (h: Uint16Array) => Math.min(...orig.dihedral.map((d) => distance(d, h)));
  // 左右翻轉、上下翻轉、轉 90 度、轉 180 度：都跟 8 個方向的其中一個幾乎相同，跟原本的方向差很多
  for (const map of [(x: number, y: number): [number, number] => [n - 1 - x, y], (x: number, y: number): [number, number] => [x, n - 1 - y], (x: number, y: number): [number, number] => [y, n - 1 - x], (x: number, y: number): [number, number] => [n - 1 - x, n - 1 - y]]) {
    const h = make(map);
    expect(dist(h)).toBeLessThanOrEqual(2);
    expect(distance(orig.hash, h)).toBeGreaterThan(60);
  }
});

test("PDQ：距離與十六進位的轉換", () => {
  const a = fromHex(REF[0]!.hashes[0]!);
  expect(hex(a)).toBe(REF[0]!.hashes[0]);
  expect(distance(a, a)).toBe(0);
  const b = Uint16Array.from(a);
  b[0] = b[0]! ^ 0b111;
  expect(distance(a, b)).toBe(3);
});

test("PDQ：小於 5 像素的圖不算雜湊", () => {
  expect(pdqFromRGBA(new Uint8Array(4 * 4 * 4), 4, 4).quality).toBe(0);
});
