import { expect, test } from "./guard.ts";

// public/legacy-check.js：主程式的正規表示式用到 lookbehind，Safari 16.4（iOS 16.4）以前打不開 Gears。
// 這裡把 RegExp 換成遇到 lookbehind 就丟出錯誤的版本，模擬舊的瀏覽器。主程式裡的正規表示式是字面值，
// 不經過 RegExp 建構子，工作台照樣執行，只用來確認偵測與提示
test("不支援 lookbehind 的瀏覽器顯示需要 iOS 16.4 以上的提示", async ({ page }) => {
  await page.addInitScript(() => {
    const Original = RegExp;
    const Patched = function (this: unknown, pattern: string | RegExp, flags?: string) {
      if (typeof pattern === "string" && /\(\?<[=!]/.test(pattern)) throw new SyntaxError("Invalid regular expression: invalid group specifier name");
      return new Original(pattern, flags);
    } as unknown as RegExpConstructor;
    (globalThis as unknown as { RegExp: RegExpConstructor }).RegExp = Patched;
  });
  await page.goto("./");
  const note = page.locator("#legacy-browser");
  await expect(note).toBeVisible();
  await expect(note).toContainText("iOS 16.4");
});

test("一般的瀏覽器不顯示提示，英文頁的提示是英文", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#legacy-browser")).toBeHidden();
  await page.goto("./en/");
  await expect(page.locator("#legacy-browser")).toBeHidden();
  await expect(page.locator("#legacy-browser")).toHaveText(/This browser is too old to run Gears/);
});
