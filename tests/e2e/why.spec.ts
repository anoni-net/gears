import { MODEL_CATALOG } from "../../src/core/model-catalog.ts";
import { TOOL_GROUPS } from "../../src/ui/tool-meta.ts";
import { PEERS } from "../../src/ui/why-peers.ts";
import { expect, test } from "./guard.ts";

// 為什麼做 Gears（src/ui/WhyPage.tsx）：入口、同類工具與對照表跟 src/ui/why-peers.ts 一致，
// 工具數與模型數跟著程式裡的設定，三個語系都沒有露出字串的鍵

const tools = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);

test("從桌面的使用者區打開，工具數、模型數與同類工具跟程式裡的設定一致", async ({ page }) => {
  await page.goto("./");
  await page.locator(".desk-user").getByRole("link", { name: "為什麼做 Gears" }).click();
  await expect(page).toHaveURL(/\/why\/$/);
  const why = page.getByTestId("why");
  await expect(why.getByRole("heading", { level: 1, name: "為什麼做 Gears" })).toBeVisible();
  await expect(why).toContainText(`一共 ${tools} 個工具`);
  await expect(why).toContainText(`一共用到 ${MODEL_CATALOG.length} 個模型`);
  // 每一項同類工具都列出來，對照表是 Gears 加上有涵蓋的那幾項
  for (const p of PEERS) await expect(why.locator(`.why-peers [data-peer="${p.id}"]`)).toHaveCount(1);
  const rows = why.getByTestId("why-matrix").locator("tbody tr");
  await expect(rows).toHaveCount(1 + PEERS.filter((p) => p.covers?.length).length);
  await expect(rows.first()).toHaveAttribute("data-peer", "gears");
  // 外部連結開新分頁
  const external = await why.locator('a[href^="http"]').evaluateAll((links) => links.map((a) => [a.getAttribute("target"), a.getAttribute("rel")]));
  expect(external.length).toBeGreaterThan(0);
  for (const [target, rel] of external) {
    expect(target).toBe("_blank");
    expect(rel).toContain("noopener");
  }
});

test("每個提到的工具前面都有圖示，從自己的網域載入，找不到官方圖示的放佔位", async ({ page }) => {
  await page.goto("./why/");
  const why = page.getByTestId("why");
  const imgs = why.locator(".why-logo img");
  await expect(imgs.first()).toBeVisible();
  await expect
    .poll(() => imgs.evaluateAll((els) => els.filter((el) => !(el as HTMLImageElement).complete || (el as HTMLImageElement).naturalWidth === 0).length))
    .toBe(0);
  const srcs = await imgs.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src));
  for (const src of srcs) expect(new URL(src).origin).toBe(new URL(page.url()).origin);
  // 名稱就在旁邊，圖片不唸出來
  expect(await imgs.evaluateAll((els) => els.every((el) => el.getAttribute("alt") === ""))).toBe(true);
  // 每一項同類工具的每個名稱前面都有一個圖示
  for (const p of PEERS) await expect(why.locator(`.why-peers [data-peer="${p.id}"] .why-peer-name .why-logo`)).toHaveCount(p.names.length);
  // 麥騙沒有官方圖示，用中性的圖示佔位
  await expect(why.locator('.why-peers [data-peer="maipian"] .why-logo.none')).toHaveCount(1);
  // 對照表的 Gears 那一列用自己的網站圖示
  await expect(why.getByTestId("why-matrix").locator('tr[data-peer="gears"] img')).toHaveAttribute("src", /favicon\.svg$/);
});

test("手機上對照表排成小卡，Gears 那一列的文字跟底色的邊留有距離", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./why/");
  const row = page.getByTestId("why-matrix").locator('tr[data-peer="gears"]');
  const box = (await row.boundingBox())!;
  // 每一格的文字都在色塊裡，左右至少留 8 px
  for (const cell of await row.locator("th, td").all()) {
    const c = (await cell.boundingBox())!;
    expect(c.x - box.x, await cell.innerText()).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width - (c.x + c.width), await cell.innerText()).toBeGreaterThanOrEqual(8);
  }
});

test("模型表連到設計原則頁的那一段，設計原則的延伸閱讀也連回來", async ({ page }) => {
  await page.goto("./why/");
  await page.getByRole("link", { name: "設計原則的模型表" }).click();
  await expect(page).toHaveURL(/\/about\/#models-list$/);
  await page.getByTestId("about-more").getByRole("link", { name: "為什麼做 Gears" }).click();
  await expect(page).toHaveURL(/\/why\/$/);
});

for (const [path, title] of [
  ["./why/", "為什麼做 Gears"],
  ["./zh-cn/why/", "为什么做 Gears"],
  ["./en/why/", "Why Gears"],
] as const) {
  test(`${path} 沒有露出字串的鍵`, async ({ page }) => {
    await page.goto(path);
    const why = page.getByTestId("why");
    await expect(why.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const text = (await why.textContent()) ?? "";
    expect(text).not.toMatch(/\b(why|desk|about|tool)\.[a-z]/);
    expect(text).not.toContain("{");
  });
}
