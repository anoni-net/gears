import { expect, test } from "./guard.ts";

const SAMPLE = "老實說我真的受不了了啦😤 主管叫大家把加班時數改成8小時以內!!! 不改考績就打C 這個視頻的用戶很多,有事打0912-345-678";

test("從任務打開寫作習慣檢查，標出寫作習慣，修正標點與符號之後可以復原", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /要匿名發表的文字/ }).click();
  await expect(page).toHaveURL(/\/writing-style\/$/);
  const input = page.getByLabel("要交出去的文字");
  await input.fill(SAMPLE);

  const summary = page.getByTestId("style-summary");
  await expect(summary).toContainText("可以直接修正");
  // 需要讀者自己改的放前面，可以直接修正的放後面，各自寫出建議的寫法
  const manual = page.getByTestId("style-manual");
  const auto = page.getByTestId("style-auto");
  for (const label of ["語助詞", "口頭禪", "中國用語", "個資"]) await expect(manual.getByText(label, { exact: true })).toBeVisible();
  for (const label of ["表情符號與顏文字", "誇張的標點", "半形標點"]) await expect(auto.getByText(label, { exact: true })).toBeVisible();
  await expect(auto.getByText("會換成「！」")).toBeVisible();
  // 考績打 C 的 C 不算中英夾雜
  await expect(manual.getByText("中英夾雜", { exact: true })).toHaveCount(0);
  // 中國用語附上台灣的說法，個資標出類別
  await expect(manual.getByText("建議改成「影片」")).toBeVisible();
  await expect(manual.getByText("電話號碼")).toBeVisible();
  await expect(page.locator(".style-preview mark.pii")).toHaveText("0912-345-678");

  await page.getByRole("button", { name: "修正標點與符號" }).click();
  await expect(input).toHaveValue("老實說我真的受不了了啦，主管叫大家把加班時數改成8小時以內！不改考績就打C 這個視頻的用戶很多，有事打0912-345-678");
  await expect(summary).toHaveText("已修正 3 處。找到 5 處寫作習慣，需要你自己修改。");
  // 剩下的要讀者自己改，修正按鈕停用
  await expect(page.getByRole("button", { name: "修正標點與符號" })).toBeDisabled();
  await expect(auto).toHaveCount(0);
  await expect(manual.getByText("語助詞", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "復原" }).click();
  await expect(input).toHaveValue(SAMPLE);
});

test("沒有寫作習慣時說明找不到，修正按鈕停用", async ({ page }) => {
  await page.goto("./writing-style/");
  await page.getByLabel("要交出去的文字").fill("主管要求大家把加班時數改成八小時以內。");
  await expect(page.getByTestId("style-summary")).toHaveText("沒有找到常見的寫作習慣。");
  await expect(page.getByRole("button", { name: "修正標點與符號" })).toBeDisabled();
  await expect(page.locator(".style-preview")).toHaveCount(0);
});
