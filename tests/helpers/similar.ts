import type { Page } from "@playwright/test";

// 查證的相近的圖片（tests/e2e/verify-similar.spec.ts 等）用的測試圖：在頁面裡用 canvas 畫大塊的形狀與漸層，
// PDQ 的品質才夠高（2026-11-22 量過：原圖對縮小版的距離 2、對翻轉版 18，對另一張圖與裁掉一成的版本都在 114 以上）。
// 抽象的圖形對 DINOv2 來說彼此都很像，模型的分組要用真的照片，見 verify-similar.spec.ts 的最後一項

export type Kind = "orig" | "small" | "flip" | "other" | "crop";

// 畫一張圖，回傳檔案的位元組。orig 是 1200 × 800 的 JPEG，small 縮成一半再壓得比較重，flip 左右翻轉成 PNG，
// crop 從四周各裁掉一成，other 是另一張構圖不同的圖
export async function similarImage(page: Page, kind: Kind) {
  const data = await page.evaluate(async (kind) => {
    const draw = (g: CanvasRenderingContext2D, w: number, h: number, other: boolean) => {
      const bg = g.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, other ? "#16324f" : "#f4d35e");
      bg.addColorStop(1, other ? "#e8eef2" : "#0d3b66");
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      const shapes = other
        ? [["#c1121f", 0.7, 0.3, 0.2], ["#ffffff", 0.2, 0.7, 0.15], ["#2a9d8f", 0.45, 0.45, 0.1]]
        : [["#ee964b", 0.25, 0.35, 0.18], ["#faf0ca", 0.7, 0.6, 0.22], ["#1b998b", 0.55, 0.2, 0.08], ["#2e294e", 0.15, 0.8, 0.12]];
      for (const [color, x, y, r] of shapes as [string, number, number, number][]) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x * w, y * h, r * w, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = other ? "#003049" : "#f95738";
      g.fillRect(w * (other ? 0.1 : 0.6), h * 0.1, w * 0.25, h * 0.12);
      g.fillRect(w * (other ? 0.55 : 0.05), h * 0.55, w * 0.08, h * 0.35);
    };
    const W = 1200;
    const H = 800;
    const base = document.createElement("canvas");
    base.width = kind === "other" ? 1000 : W;
    base.height = kind === "other" ? 750 : H;
    draw(base.getContext("2d")!, base.width, base.height, kind === "other");
    let out = base;
    if (kind === "small" || kind === "flip" || kind === "crop") {
      out = document.createElement("canvas");
      const g = out.getContext("2d")!;
      if (kind === "small") {
        out.width = W / 2;
        out.height = H / 2;
        g.drawImage(base, 0, 0, W / 2, H / 2);
      } else if (kind === "flip") {
        out.width = W;
        out.height = H;
        g.translate(W, 0);
        g.scale(-1, 1);
        g.drawImage(base, 0, 0);
      } else {
        out.width = W * 0.8;
        out.height = H * 0.8;
        g.drawImage(base, W * 0.1, H * 0.1, W * 0.8, H * 0.8, 0, 0, W * 0.8, H * 0.8);
      }
    }
    const type = kind === "flip" ? "image/png" : "image/jpeg";
    const b = await new Promise<Blob>((r) => out.toBlob((x) => r(x!), type, kind === "small" ? 0.6 : 0.92));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, kind);
  return Buffer.from(data);
}

