import { expect, test } from "@playwright/test";
import type { PdqHash } from "../../src/tools/verify/pdq.ts";
import { DINO_THRESHOLD, type ImageSig, PDQ_THRESHOLD, closeness, dinoDistance, groupSimilar, pairLayer, pdqDistance } from "../../src/tools/verify/similar.ts";

// 查證的相似圖片：距離、8 個方向、組裡每一對都相近才併、一張圖接近兩組、依哪一層判斷相近（src/tools/verify/similar.ts）。
// 雜湊與特徵直接組出來，距離是精確的

let seed = 1;
const rand16 = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed & 0xffff;
};
const randomHash = () => Uint16Array.from({ length: 16 }, rand16);

// 從 base 翻轉前 k 個位元
function flip(base: Uint16Array, k: number, from = 0): Uint16Array {
  const out = Uint16Array.from(base);
  for (let b = from; b < from + k; b++) out[b >> 4]! ^= 1 << (b & 15);
  return out;
}

// 原本的方向是 hash，其他 7 個方向是不相干的雜湊；rot90 可以指定
function pdq(hash: Uint16Array, { quality = 100, rot90 }: { quality?: number; rot90?: Uint16Array } = {}): PdqHash {
  const dihedral = [hash, rot90 ?? randomHash(), ...Array.from({ length: 6 }, randomHash)];
  return { hash, quality, dihedral };
}

// 二維的單位向量，兩個角度差 θ 時 1 − cos θ 就是距離
const unit = (deg: number) => Float32Array.from([Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]);
// 距離剛好是 d 的角度
const angle = (d: number) => (Math.acos(1 - d) * 180) / Math.PI;

test("PDQ 的距離：31 以內相近，品質 49 以下不採用", () => {
  const h = randomHash();
  const a: ImageSig = { id: 1, pdq: pdq(h) };
  expect(pdqDistance(a, { id: 2, pdq: pdq(flip(h, 31)) })).toBe(31);
  expect(pairLayer(a, { id: 2, pdq: pdq(flip(h, 31)) })).toBe("pdq");
  expect(pairLayer(a, { id: 2, pdq: pdq(flip(h, 32)) })).toBeNull();
  // 純色的圖雜湊幾乎一樣，品質低的不比
  expect(pdqDistance({ id: 1, pdq: pdq(h, { quality: 49 }) }, { id: 2, pdq: pdq(h, { quality: 49 }) })).toBeNull();
  expect(pdqDistance({ id: 1, pdq: pdq(h, { quality: 50 }) }, { id: 2, pdq: pdq(h) })).toBe(0);
});

test("PDQ 的 8 個方向：轉過的版本跟原圖的某個方向相同就算相近，兩邊各算一次", () => {
  const h = randomHash();
  const turned = randomHash();
  // b 是 a 轉 90 度：a 的 rot90 方向等於 b 原本的雜湊
  const a: ImageSig = { id: 1, pdq: pdq(h, { rot90: flip(turned, 3) }) };
  const b: ImageSig = { id: 2, pdq: pdq(turned) };
  expect(pdqDistance(a, b)).toBe(3);
  expect(pdqDistance(b, a)).toBe(3);
});

test("DINOv2 的距離：1 − cos，0.15 以內相近", () => {
  const a: ImageSig = { id: 1, dino: unit(0) };
  expect(dinoDistance(a, { id: 2, dino: unit(angle(0.1)) })).toBeCloseTo(0.1, 5);
  expect(pairLayer(a, { id: 2, dino: unit(angle(0.14)) })).toBe("dino");
  expect(pairLayer(a, { id: 2, dino: unit(angle(0.16)) })).toBeNull();
  expect(dinoDistance(a, { id: 2 })).toBeNull();
});

test("PDQ 判斷相近時就算 PDQ 這一層，兩層換成同一把尺比較遠近", () => {
  const h = randomHash();
  const a: ImageSig = { id: 1, pdq: pdq(h), dino: unit(0) };
  const b: ImageSig = { id: 2, pdq: pdq(flip(h, 10)), dino: unit(angle(0.3)) };
  expect(pairLayer(a, b)).toBe("pdq");
  expect(closeness(a, b)).toBeCloseTo(10 / PDQ_THRESHOLD, 5);
  const c: ImageSig = { id: 3, pdq: pdq(randomHash()), dino: unit(angle(0.075)) };
  expect(pairLayer(a, c)).toBe("dino");
  expect(closeness(a, c)).toBeCloseTo(0.075 / DINO_THRESHOLD, 4);
});

test("分組：同一張圖的縮小版與翻轉版分在一起，不同的圖不分進來，組裡都是 PDQ 時寫 PDQ 的說明", () => {
  const h = randomHash();
  const turned = randomHash();
  const sigs: ImageSig[] = [
    { id: 10, pdq: pdq(h, { rot90: turned }) },
    { id: 11, pdq: pdq(flip(h, 3)) }, // 縮小、重新壓縮
    { id: 12, pdq: pdq(flip(turned, 5)) }, // 轉 90 度
    { id: 13, pdq: pdq(randomHash()) }, // 不同的圖
  ];
  // 縮小版跟轉 90 度的版本彼此之間：縮小版的 rot90 是不相干的雜湊，兩者不相近，所以組裡每一對都相近不成立
  expect(pairLayer(sigs[1]!, sigs[2]!)).toBeNull();
  const groups = groupSimilar(sigs);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.layer).toBe("pdq");
  // 原圖跟縮小版最近（3 個位元），先合併。轉 90 度的版本跟縮小版不相近，只能自己一張，在原圖下面註明
  expect(groups[0]!.ids).toEqual([10, 11]);
  expect(groups[0]!.alsoNear).toEqual([{ id: 10, near: [12] }]);
});

test("分組：組裡每一對都相近才併，相連的鏈不會連成一大組", () => {
  // a 接近 b、b 接近 c、c 接近 d，但隔一張的都不相近（像連拍的照片一張接一張）
  const sigs: ImageSig[] = [0, 20, 45, 65].map((deg, k) => ({ id: k, dino: unit(deg) }));
  expect(pairLayer(sigs[0]!, sigs[2]!)).toBeNull();
  const groups = groupSimilar(sigs);
  expect(groups.map((g) => g.ids)).toEqual([
    [0, 1],
    [2, 3],
  ]);
  expect(groups.every((g) => g.layer === "dino")).toBe(true);
  // 1 也接近 2，2 也接近 1，各自在另一組的成員下面註明
  expect(groups[0]!.alsoNear).toEqual([{ id: 1, near: [2] }]);
  expect(groups[1]!.alsoNear).toEqual([{ id: 2, near: [1] }]);
});

test("分組：一張圖接近兩組時只放一組，另外註明也跟另一組的某張相近", () => {
  // 第一組 a、b，第二組 c、d。e 跟 a、b 都相近（放進第一組），也跟 c 相近，但跟 d 不相近
  const sigs: ImageSig[] = [
    { id: 1, dino: unit(0) }, // a
    { id: 2, dino: unit(5) }, // b
    { id: 3, dino: unit(60) }, // c
    { id: 4, dino: unit(70) }, // d
    { id: 5, dino: unit(30) }, // e：跟 a 相距 30 度、跟 c 也是 30 度
  ];
  const near = (x: number, y: number) => pairLayer(sigs[x]!, sigs[y]!) !== null;
  expect([near(4, 0), near(4, 1), near(4, 2), near(4, 3)]).toEqual([true, true, true, false]);
  const groups = groupSimilar(sigs);
  expect(groups.map((g) => g.ids)).toEqual([
    [1, 2, 5],
    [3, 4],
  ]);
  const inGroups = groups.flatMap((g) => g.ids);
  expect(new Set(inGroups).size).toBe(inGroups.length);
  expect(groups[0]!.alsoNear).toEqual([{ id: 5, near: [3] }]);
  expect(groups[1]!.alsoNear).toEqual([{ id: 3, near: [5] }]);
});

test("分組：組裡有一對只有 DINOv2 判斷相近時，改寫 DINOv2 的說明", () => {
  const h = randomHash();
  const sigs: ImageSig[] = [
    { id: 1, pdq: pdq(h), dino: unit(0) },
    { id: 2, pdq: pdq(flip(h, 6)), dino: unit(2) }, // 縮小版：PDQ 相近
    { id: 3, pdq: pdq(randomHash()), dino: unit(10) }, // 裁切或同一個場景：只有 DINOv2 相近
  ];
  const groups = groupSimilar(sigs);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.ids).toEqual([1, 2, 3]);
  expect(groups[0]!.layer).toBe("dino");
  // 拿掉第三張，剩下的都是 PDQ 判斷相近
  expect(groupSimilar(sigs.slice(0, 2))[0]!.layer).toBe("pdq");
});

test("分組：只有 PDQ 時沒有特徵的圖照樣比 PDQ，什麼都不相近時沒有組", () => {
  expect(groupSimilar([])).toEqual([]);
  expect(groupSimilar([{ id: 1 }, { id: 2 }])).toEqual([]);
  const h = randomHash();
  expect(groupSimilar([{ id: 1, pdq: pdq(h), dino: unit(0) }, { id: 2, pdq: pdq(flip(h, 2)) }])[0]!.ids).toEqual([1, 2]);
});
