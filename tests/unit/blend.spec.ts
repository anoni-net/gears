import { expect, test } from "@playwright/test";
import { downscaleSteps, targetSize } from "../../src/tools/blend/index.ts";

test("等比縮到長邊，直的照片看高度，比較小的不放大", () => {
  expect(targetSize(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
  expect(targetSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  expect(targetSize(1000, 800, 2048)).toEqual({ width: 1000, height: 800 });
});

test("每次最多縮一半，最後一步落在目標尺寸", () => {
  expect(downscaleSteps(4032, 3024, { width: 1280, height: 960 })).toEqual([
    { width: 2016, height: 1512 },
    { width: 1280, height: 960 },
  ]);
  expect(downscaleSteps(8064, 6048, { width: 1280, height: 960 })).toEqual([
    { width: 4032, height: 3024 },
    { width: 2016, height: 1512 },
    { width: 1280, height: 960 },
  ]);
  // 不必縮小時只重新壓縮
  expect(downscaleSteps(1000, 800, { width: 1000, height: 800 })).toEqual([]);
});
