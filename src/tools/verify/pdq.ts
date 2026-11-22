// PDQ 感知雜湊：查證的相似圖片（src/tools/verify/similar.ts）用它找出同一張圖縮小、重新壓縮、調色、
// 翻轉之後的版本。不用模型，純 JavaScript，鎖定模式關掉 WebAssembly 時也能用。不碰 DOM，可以在 Node 裡測試。
//
// 照 meta/ThreatExchange 9f627fb1 的 C++ 參考實作逐段改寫，評測與移植的過程在社群工作區的
// research/gears-similar/（pdq/pdq.mjs）：
//   pdq/cpp/hashing/pdqhashing.cpp（亮度、DCT、品質、8 個方向、轉成位元）
//   pdq/cpp/hashing/torben.cpp（中位數）
//   pdq/cpp/downscaling/downscaling.cpp（Jarosz 濾波、抽樣）
//   pdq/cpp/io/pdqio.cpp（長或寬超過 512 時用 CImg 的最近鄰縮成 512 × 512）
// 浮點運算用 Math.fround 對齊 C++ 的 float，同一組 RGB 位元組算出完全相同的雜湊與品質（tests/unit/pdq.spec.ts）。
//
// 原始程式的授權（BSD，全文在 licenses/verify-similar.txt）：
//   Copyright (c) Meta Platforms, Inc. and affiliates.
//   Redistribution and use in source and binary forms, with or without modification, are permitted
//   provided that the conditions of the BSD license in meta/ThreatExchange/LICENSE are met:
//   redistributions must retain this copyright notice, the list of conditions and the disclaimer.

const f = Math.fround;
const DOWNSAMPLE_DIMS = 512;
const MIN_HASHABLE_DIM = 5;

const DCT = (() => {
  const m = new Float32Array(16 * 64);
  const scale = f(Math.sqrt(2.0 / 64));
  for (let i = 0; i < 16; i++) for (let j = 0; j < 64; j++) m[i * 64 + j] = f(scale * Math.cos((Math.PI / 2.0 / 64) * (i + 1) * (2 * j + 1)));
  return m;
})();

// CImg 的 resize(512, 512)，預設的最近鄰：輸出第 x 格取原圖 floor(x * W / 512)
function nearestIndex(src: number, dst: number): Int32Array {
  const idx = new Int32Array(dst);
  for (let x = 0; x < dst; x++) idx[x] = Math.floor((x * src) / dst);
  return idx;
}

export interface LumaOptions {
  channels?: number; // canvas 的 ImageData 是 4（RGBA），C++ 參考實作輸出的是 3（RGB）
  referenceResize?: boolean; // 長或寬超過 512 時照參考實作用最近鄰縮成 512 × 512
}

// RGBA 或 RGB 位元組轉成亮度
export function lumaFromRGBA(data: ArrayLike<number>, width: number, height: number, { channels = 4, referenceResize = true }: LumaOptions = {}) {
  let rows = height;
  let cols = width;
  let xi: Int32Array | null = null;
  let yi: Int32Array | null = null;
  if (referenceResize && (width > DOWNSAMPLE_DIMS || height > DOWNSAMPLE_DIMS)) {
    rows = cols = DOWNSAMPLE_DIMS;
    xi = nearestIndex(width, DOWNSAMPLE_DIMS);
    yi = nearestIndex(height, DOWNSAMPLE_DIMS);
  }
  const luma = new Float32Array(rows * cols);
  const rc = f(0.299);
  const gc = f(0.587);
  const bc = f(0.114);
  for (let i = 0; i < rows; i++) {
    const sy = yi ? yi[i]! : i;
    for (let j = 0; j < cols; j++) {
      const sx = xi ? xi[j]! : j;
      const p = (sy * width + sx) * channels;
      luma[i * cols + j] = f(f(f(rc * data[p]!) + f(gc * data[p + 1]!)) + f(bc * data[p + 2]!));
    }
  }
  return { luma, rows, cols };
}

const windowSize = (oldDim: number, newDim: number) => Math.trunc((oldDim + 2 * newDim - 1) / (2 * newDim));

function box1D(inv: Float32Array, inOff: number, outv: Float32Array, outOff: number, len: number, stride: number, full: number) {
  const half = Math.trunc((full + 2) / 2);
  const p1 = half - 1;
  const p2 = full - half + 1;
  const p3 = len - full;
  const p4 = half - 1;
  let li = 0;
  let ri = 0;
  let oi = 0;
  let sum = 0;
  let cur = 0;
  for (let i = 0; i < p1; i++) {
    sum = f(sum + inv[inOff + ri]!);
    cur++;
    ri += stride;
  }
  for (let i = 0; i < p2; i++) {
    sum = f(sum + inv[inOff + ri]!);
    cur++;
    outv[outOff + oi] = f(sum / cur);
    ri += stride;
    oi += stride;
  }
  for (let i = 0; i < p3; i++) {
    sum = f(sum + inv[inOff + ri]!);
    sum = f(sum - inv[inOff + li]!);
    outv[outOff + oi] = f(sum / cur);
    li += stride;
    ri += stride;
    oi += stride;
  }
  for (let i = 0; i < p4; i++) {
    sum = f(sum - inv[inOff + li]!);
    cur--;
    outv[outOff + oi] = f(sum / cur);
    li += stride;
    oi += stride;
  }
}

function jarosz(buf1: Float32Array, buf2: Float32Array, rows: number, cols: number, wRows: number, wCols: number, reps: number) {
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < rows; i++) box1D(buf1, i * cols, buf2, i * cols, cols, 1, wRows);
    for (let j = 0; j < cols; j++) box1D(buf2, j, buf1, j, rows, cols, wCols);
  }
}

function quality(b: Float32Array): number {
  let g = 0;
  for (let i = 0; i < 63; i++) for (let j = 0; j < 64; j++) g += Math.abs(Math.trunc(f(f(f(b[i * 64 + j]! - b[(i + 1) * 64 + j]!) * 100) / 255)));
  for (let i = 0; i < 64; i++) for (let j = 0; j < 63; j++) g += Math.abs(Math.trunc(f(f(f(b[i * 64 + j]! - b[i * 64 + j + 1]!) * 100) / 255)));
  return Math.min(100, Math.trunc(g / 90));
}

function dct64To16(A: Float32Array): Float32Array {
  const T = new Float32Array(16 * 64);
  const B = new Float32Array(256);
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 64; j++) {
      let s = 0;
      for (let k = 0; k < 64; k++) s = f(s + f(DCT[i * 64 + k]! * A[k * 64 + j]!));
      T[i * 64 + j] = s;
    }
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      let s = 0;
      for (let k = 0; k < 64; k++) s = f(s + f(T[i * 64 + k]! * DCT[j * 64 + k]!));
      B[i * 16 + j] = s;
    }
  return B;
}

function torben(m: Float32Array): number {
  const n = m.length;
  let min = m[0]!;
  let max = m[0]!;
  for (let i = 1; i < n; i++) {
    if (m[i]! < min) min = m[i]!;
    if (m[i]! > max) max = m[i]!;
  }
  let less = 0;
  let greater = 0;
  let equal = 0;
  let guess = 0;
  let maxlt = 0;
  let mingt = 0;
  for (;;) {
    guess = f((min + max) / 2);
    less = greater = equal = 0;
    maxlt = min;
    mingt = max;
    for (let i = 0; i < n; i++) {
      const v = m[i]!;
      if (v < guess) {
        less++;
        if (v > maxlt) maxlt = v;
      } else if (v > guess) {
        greater++;
        if (v < mingt) mingt = v;
      } else equal++;
    }
    if (less <= (n + 1) >> 1 && greater <= (n + 1) >> 1) break;
    else if (less > greater) max = maxlt;
    else min = mingt;
  }
  if (less >= (n + 1) >> 1) return maxlt;
  if (less + equal >= (n + 1) >> 1) return guess;
  return mingt;
}

// 256 位元存成 16 個 16 位元的字，第 k 位在 w[k >> 4] 的第 (k & 15) 位，跟 C++ 的 Hash256 相同
function toBits(B: Float32Array): Uint16Array {
  const med = torben(B);
  const w = new Uint16Array(16);
  for (let k = 0; k < 256; k++) if (B[k]! > med) w[k >> 4]! |= 1 << (k & 15);
  return w;
}

// 8 個方向，直接在 16 × 16 的 DCT 係數上換號與轉置（pdqhashing.cpp 的 dct16OriginalTo*），順序跟 C++ 的
// pdq-photo-hasher --pdqdih 相同
type Dihedral = (A: Float32Array, B: Float32Array) => void;
const DIHEDRAL: Record<Orientation, Dihedral> = {
  orig: (A, B) => B.set(A),
  rot90: (A, B) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) B[j * 16 + i] = j & 1 ? A[i * 16 + j]! : -A[i * 16 + j]!;
  },
  rot180: (A, B) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) B[i * 16 + j] = (i + j) & 1 ? -A[i * 16 + j]! : A[i * 16 + j]!;
  },
  rot270: (A, B) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) B[j * 16 + i] = i & 1 ? A[i * 16 + j]! : -A[i * 16 + j]!;
  },
  flipX: (A, B) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) B[i * 16 + j] = i & 1 ? A[i * 16 + j]! : -A[i * 16 + j]!;
  },
  flipY: (A, B) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) B[i * 16 + j] = j & 1 ? A[i * 16 + j]! : -A[i * 16 + j]!;
  },
  flipPlus1: (A, B) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) B[j * 16 + i] = A[i * 16 + j]!;
  },
  flipMinus1: (A, B) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) B[j * 16 + i] = (i + j) & 1 ? -A[i * 16 + j]! : A[i * 16 + j]!;
  },
};

export const ORIENTATIONS = ["orig", "rot90", "rot180", "rot270", "flipX", "flipY", "flipPlus1", "flipMinus1"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

// 跟 C++ 的 Hash256::format() 相同：第 15 個字在最前面
export function hex(w: Uint16Array): string {
  let s = "";
  for (let i = 15; i >= 0; i--) s += w[i]!.toString(16).padStart(4, "0");
  return s;
}

export function fromHex(h: string): Uint16Array {
  const w = new Uint16Array(16);
  for (let i = 0; i < 16; i++) w[15 - i] = parseInt(h.slice(i * 4, i * 4 + 4), 16);
  return w;
}

const POP = new Uint8Array(65536).map((_, i) => {
  let c = 0;
  for (let x = i; x; x >>= 1) c += x & 1;
  return c;
});

// 兩個雜湊相差幾個位元（漢明距離，0 到 256）
export function distance(a: Uint16Array, b: Uint16Array): number {
  let d = 0;
  for (let i = 0; i < 16; i++) d += POP[a[i]! ^ b[i]!]!;
  return d;
}

export interface PdqHash {
  hash: Uint16Array; // 原本的方向
  quality: number; // 0 到 100，參考實作建議 49 以下的雜湊不要用
  dihedral: Uint16Array[]; // 8 個方向，順序同 ORIENTATIONS，第一個就是 hash
}

// 亮度 → 雜湊與 8 個方向
export function pdqFromLuma(luma: Float32Array, rows: number, cols: number): PdqHash {
  if (rows < MIN_HASHABLE_DIM || cols < MIN_HASHABLE_DIM) {
    const zero = new Uint16Array(16);
    return { hash: zero, quality: 0, dihedral: ORIENTATIONS.map(() => zero) };
  }
  let b64: Float32Array;
  if (rows === 64 && cols === 64) b64 = Float32Array.from(luma);
  else {
    const buf1 = Float32Array.from(luma);
    const buf2 = new Float32Array(rows * cols);
    jarosz(buf1, buf2, rows, cols, windowSize(cols, 64), windowSize(rows, 64), 2);
    b64 = new Float32Array(64 * 64);
    for (let oi = 0; oi < 64; oi++) {
      const ii = Math.trunc(((oi + 0.5) * rows) / 64);
      for (let oj = 0; oj < 64; oj++) b64[oi * 64 + oj] = buf1[ii * cols + Math.trunc(((oj + 0.5) * cols) / 64)]!;
    }
  }
  const q = quality(b64);
  const B = dct64To16(b64);
  const aux = new Float32Array(256);
  const dihedral = ORIENTATIONS.map((name) => {
    DIHEDRAL[name](B, aux);
    return toBits(aux);
  });
  return { hash: dihedral[0]!, quality: q, dihedral };
}

export function pdqFromRGBA(data: ArrayLike<number>, width: number, height: number, opts: LumaOptions = {}): PdqHash {
  const { luma, rows, cols } = lumaFromRGBA(data, width, height, opts);
  return pdqFromLuma(luma, rows, cols);
}
