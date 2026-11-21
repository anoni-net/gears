import { expect, test } from "./guard.ts";

const SAMPLE = "老實說我真的受不了了啦😤 主管叫大家把加班時數改成8小時以內!!! 不改考績就打C 這個視頻的用戶很多,有事打0912-345-678";

test("從任務打開寫作習慣檢查，標出寫作習慣，修正標點與符號之後可以復原", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: /要匿名發表的文字/ }).click();
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
  await expect(manual.getByRole("button", { name: "把「視頻」改成「影片」" })).toBeVisible();
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

test("逐項套用建議、整組套用，一步一步復原", async ({ page }) => {
  await page.goto("./writing-style/");
  const input = page.getByLabel("要交出去的文字");
  const text = "老實說這個視頻的用戶很多啦，其他視頻也一樣";
  await input.fill(text);
  const manual = page.getByTestId("style-manual");
  await manual.getByRole("button", { name: "把「視頻」改成「影片」（2 處）" }).click();
  await expect(input).toHaveValue("老實說這個影片的用戶很多啦，其他影片也一樣");
  await expect(page.getByTestId("style-summary")).toContainText("已套用 2 處。");
  await manual.getByRole("button", { name: "刪掉「啦」" }).click();
  await manual.getByRole("button", { name: "刪掉「老實說」" }).click();
  await expect(input).toHaveValue("這個影片的用戶很多，其他影片也一樣");
  await page.getByRole("button", { name: "復原" }).click();
  await expect(input).toHaveValue("老實說這個影片的用戶很多，其他影片也一樣");
  await page.getByRole("button", { name: "復原" }).click();
  await page.getByRole("button", { name: "復原" }).click();
  await expect(input).toHaveValue(text);
  await expect(page.getByRole("button", { name: "復原" })).toHaveCount(0);

  // 一組裡有兩種以上的寫法時，可以整組套用
  await input.fill("這個視頻的用戶很多");
  await manual.getByRole("button", { name: "這一類全部套用（2 處）" }).click();
  await expect(input).toHaveValue("這個影片的使用者很多");
});

test("個資換成代稱，可以復原。有文字時列出工具找不到的線索", async ({ page }) => {
  await page.goto("./writing-style/");
  // 還沒貼上文字時只有一句提醒
  await expect(page.getByTestId("style-clues")).toHaveCount(0);
  await expect(page.getByText("改變寫作風格不會拿掉內容本身透露的線索")).toBeVisible();

  const input = page.getByLabel("要交出去的文字");
  const text = "林組長說有事打 0912-345-678，或寫信到 tipster@example.com";
  await input.fill(text);
  const manual = page.getByTestId("style-manual");
  await expect(manual.getByText("電話號碼")).toBeVisible();
  await manual.getByRole("button", { name: "把「0912-345-678」改成「〔電話〕」" }).click();
  await expect(input).toHaveValue("林組長說有事打〔電話〕，或寫信到 tipster@example.com");
  await page.getByRole("button", { name: "復原" }).click();
  await expect(input).toHaveValue(text);
  await manual.getByRole("button", { name: "這一類全部套用（2 處）" }).click();
  await expect(input).toHaveValue("林組長說有事打〔電話〕，或寫信到〔Email〕");
  // 換上的代稱不再被標成寫作習慣（〔Email〕裡的英文不算中英夾雜）
  await expect(page.getByTestId("style-summary")).toHaveText("已套用 2 處。沒有找到常見的寫作習慣。");

  // 人名找不到，清單提醒讀者自己看
  const clues = page.getByTestId("style-clues");
  await expect(clues.getByRole("heading", { name: "內容透露的線索" })).toBeVisible();
  await expect(clues.getByRole("checkbox")).toHaveCount(6);
  await clues.getByRole("checkbox", { name: /^人名、暱稱與稱呼/ }).check();
  await expect(clues.getByRole("checkbox", { name: /^人名、暱稱與稱呼/ })).toBeChecked();
  await expect(page.getByText("改變寫作風格不會拿掉內容本身透露的線索")).toHaveCount(0);
});

test("自己指定要換掉的字，一次換成同一個代稱，可以復原", async ({ page }) => {
  await page.goto("./writing-style/");
  const input = page.getByLabel("要交出去的文字");
  const text = "林組長說小美跟林組長都在信義分店";
  await input.fill(text);
  const form = page.getByTestId("style-alias");
  await form.getByLabel("要換掉的字").fill("林組長");
  await form.getByRole("button", { name: "全部換成〔人名 A〕" }).click();
  await expect(input).toHaveValue("〔人名 A〕說小美跟〔人名 A〕都在信義分店");
  await expect(page.getByTestId("style-summary")).toContainText("已把 2 處「林組長」換成〔人名 A〕。");
  // 下一個人名換成 B，單位另外從 A 開始
  await form.getByLabel("要換掉的字").fill("小美");
  await form.getByRole("button", { name: "全部換成〔人名 B〕" }).click();
  await form.getByRole("radio", { name: "地點" }).check();
  await form.getByLabel("要換掉的字").fill("信義分店");
  await form.getByRole("button", { name: "全部換成〔地點 A〕" }).click();
  await expect(input).toHaveValue("〔人名 A〕說〔人名 B〕跟〔人名 A〕都在〔地點 A〕");
  // 代稱不再被標成寫作習慣
  await expect(page.getByTestId("style-summary")).toContainText("沒有找到常見的寫作習慣。");
  // 只有一個字時提醒其他詞裡的同一個字也會被換掉
  await form.getByLabel("要換掉的字").fill("跟");
  await form.getByRole("button", { name: "全部換成〔地點 B〕" }).click();
  await expect(page.getByTestId("style-summary")).toContainText("其他詞裡的同一個字也會被換掉");
  await page.getByRole("button", { name: "復原" }).click();
  await expect(input).toHaveValue("〔人名 A〕說〔人名 B〕跟〔人名 A〕都在〔地點 A〕");
  // 找不到時說明，文字不動
  await form.getByLabel("要換掉的字").fill("王經理");
  await form.getByRole("button", { name: /^全部換成/ }).click();
  await expect(page.getByTestId("style-summary")).toContainText("文字裡沒有「王經理」。");
});
