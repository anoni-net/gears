import models from "../../src/tools/llm-bench/models.json" with { type: "json" };
import { expect, test } from "./guard.ts";

test("語言模型速度量測：實驗頁說明下載來源，不進 sitemap，搜尋引擎不收錄", async ({ page, request }) => {
  await page.goto("./llm-bench/");
  await expect(page.getByRole("heading", { name: "語言模型速度量測" })).toBeVisible();
  await expect(page.getByTestId("bench-remote")).toContainText("Hugging Face 看得到你的 IP 位址");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  for (const info of Object.values(models)) await expect(page.getByLabel(new RegExp(`^${info.name.replace(".", "\\.")}`))).toBeVisible();
  // 桌面沒有入口，從頁尾連過去
  await page.goto("./");
  await expect(page.locator("main").getByText("語言模型速度量測")).toHaveCount(0);
  await page.getByRole("button", { name: "語言模型速度量測（實驗）" }).click();
  await expect(page).toHaveURL(/\/gears\/llm-bench\/$/);
  await expect(page.getByRole("heading", { name: "語言模型速度量測" })).toBeVisible();

  const html = await (await request.get("./llm-bench/")).text();
  expect(html).toContain('<meta name="robots" content="noindex" />');
  const sitemap = await (await request.get("./sitemap.xml")).text();
  expect(sitemap).toContain("/gears/licenses/");
  expect(sitemap).not.toContain("llm-bench");
});

test("語言模型速度量測：從鎖定的 commit 下載，下載失敗時畫面上說明是哪個檔案", async ({ page, guard }) => {
  const asked: string[] = [];
  await page.context().route("https://huggingface.co/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("./llm-bench/");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  await page.getByLabel(/^Qwen3 0\.6B/).check();
  await page.getByLabel("CPU", { exact: true }).check();
  await page.getByRole("button", { name: "開始量測" }).click();
  await expect(page.getByTestId("bench-status")).toContainText("量測失敗", { timeout: 30_000 });
  const pinned = `https://huggingface.co/${models["qwen3-0.6b"].repo}/resolve/${models["qwen3-0.6b"].revision}/`;
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(pinned))).toBe(true);
  await expect(page.getByRole("button", { name: "開始量測" })).toBeEnabled();
  guard.requests = guard.requests.filter((url) => !url.startsWith("https://huggingface.co/"));
  // 測試故意回 404，WebKit 會把它記成主控台錯誤
  guard.errors = guard.errors.filter((e) => !e.includes("status of 404"));
});
