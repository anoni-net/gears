import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 工具以外的頁面在寬螢幕的左欄（src/ui/PageAside.tsx）：暫存區的摘要、使用者區的頁面與本頁目錄。
// 已下載的模型那一頁的儲存空間與持久儲存（src/ui/StorageQuota.tsx）另外在下半部測

async function addFile(page: Page) {
  await page.getByTestId("file-input").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.locator(".tray .item")).toHaveCount(1);
  // 加入之後打開的是檔案畫面，回到桌面才看得到使用者區
  await page.locator(".site-header").getByRole("button", { name: "回到桌面" }).click();
  await expect(page.locator(".desk-user")).toBeVisible();
}

// 頁面有沒有重新載入：在 window 上留一個記號，重新載入之後就不見了
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { gearsMark: number }).gearsMark = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { gearsMark?: number }).gearsMark === 1);

test.describe("寬螢幕的左欄", () => {
  test.skip(({ isMobile }) => isMobile, "手機上不顯示左欄");

  test("暫存區沒有檔案時只留一行說明，有檔案時寫出數量、回到桌面不重新載入，檔案還在", async ({ page }) => {
    await page.goto("./privacy/");
    const tray = page.getByTestId("aside-tray");
    await expect(tray).toHaveText("暫存區沒有檔案。");
    await expect(tray.getByRole("link")).toHaveCount(0);

    await page.goto("./");
    await addFile(page);
    await mark(page);
    await page.locator(".desk-user").getByRole("link", { name: "範例" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "範例" })).toBeVisible();
    await expect(tray).toContainText("暫存區有 1 個檔案，仍留在這個分頁裡。");
    // 不是可以操作的暫存區：沒有選檔案的按鈕，也不列出檔案
    await expect(tray.getByRole("button")).toHaveCount(0);
    await expect(tray).not.toContainText("note.txt");

    await tray.getByRole("link", { name: "回到桌面" }).click();
    await expect(page).toHaveURL(/\/gears\/$/);
    await expect(page.locator(".tray .item")).toHaveCount(1);
    expect(await marked(page)).toBe(true);
  });

  test("使用者區的頁面標出目前的頁面，點了換頁不重新載入，暫存區還在", async ({ page }) => {
    await page.goto("./");
    await addFile(page);
    await mark(page);
    await page.locator(".desk-user").getByRole("link", { name: "協助測試" }).click();
    const pages = page.getByTestId("aside-pages");
    await expect(pages.getByRole("link", { name: "協助測試" })).toHaveAttribute("aria-current", "page");
    await expect(pages.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(pages.getByRole("link")).toHaveText(["設計原則", "為什麼做 Gears", "範例", "建議與回饋", "協助測試", "已下載的模型", "裝置量測（實驗）", "授權與來源", "隱私說明"]);

    await pages.getByRole("link", { name: "已下載的模型" }).click();
    await expect(page).toHaveURL(/\/storage\/$/);
    await expect(pages.getByRole("link", { name: "已下載的模型" })).toHaveAttribute("aria-current", "page");
    await expect(pages.getByRole("link", { name: "協助測試" })).not.toHaveAttribute("aria-current");

    await pages.getByRole("link", { name: "授權與來源" }).click();
    await expect(page).toHaveURL(/\/licenses\/$/);
    await expect(pages.getByRole("link", { name: "授權與來源" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("aside-tray")).toContainText("暫存區有 1 個檔案");
    expect(await marked(page)).toBe(true);
  });

  test("本頁目錄依右欄的小標題產生，點了捲到那一段並標出讀到哪裡", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("./testing/");
    const toc = page.getByTestId("aside-toc");
    // 每一項底下重複的「需要的裝置」與步驟的小標題沒有 id，不列進來
    await expect(toc.getByRole("link")).toHaveText(["手機上的模型量測", "逐字稿的語音偵測", "逐字稿的標點建議", "查證的相似圖片", "使用時遇到的問題"]);
    await expect(page.getByRole("navigation", { name: "本頁目錄" })).toBeVisible();

    await mark(page);
    await toc.getByRole("link", { name: "逐字稿的標點建議" }).click();
    await expect(page).toHaveURL(/\/testing\/#testing-punct$/);
    const target = page.locator("#testing-punct");
    await expect(target).toBeFocused();
    await expect.poll(async () => (await target.boundingBox())!.y).toBeLessThan(100);
    await expect(toc.getByRole("link", { name: "逐字稿的標點建議" })).toHaveAttribute("aria-current", "location");
    await expect(toc.locator('[aria-current="location"]')).toHaveCount(1);
    expect(await marked(page)).toBe(true);

    // 往回捲，讀到的那一段跟著換
    await page.evaluate(() => scrollTo(0, document.getElementById("testing-phone")!.getBoundingClientRect().top + scrollY - 20));
    await expect(toc.getByRole("link", { name: "手機上的模型量測" })).toHaveAttribute("aria-current", "location");
  });

  test("小標題少於 3 個的頁面不顯示目錄，換頁之後目錄跟著換", async ({ page }) => {
    await page.goto("./feedback/");
    await expect(page.getByTestId("aside-pages")).toBeVisible();
    await expect(page.getByTestId("aside-toc")).toHaveCount(0);
    await page.getByTestId("aside-pages").getByRole("link", { name: "隱私說明" }).click();
    await expect(page.getByTestId("aside-toc").getByRole("link")).toHaveCount(9);
    await expect(page.getByTestId("aside-toc").getByRole("link").first()).toHaveText(await page.locator("#privacy-local").innerText());
  });

  test("授權與來源依用途分組，目錄列出每一組與每一項", async ({ page }) => {
    await page.goto("./licenses/");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["工作台本身", "模型與執行環境", "讀寫檔案的程式", "驗證簽章與憑證", "圖示與資料"]);
    const toc = page.getByTestId("aside-toc");
    await expect(toc.getByRole("link")).toHaveCount(5 + 15);
    await expect(toc.locator("li:not(.sub) a")).toHaveText(["工作台本身", "模型與執行環境", "讀寫檔案的程式", "驗證簽章與憑證", "圖示與資料"]);
    await expect(toc.locator("li.sub a").nth(0)).toHaveText("檔案工作台");
    await expect(toc.locator("li.sub a").nth(1)).toHaveText("逐字稿");
  });

  test("目錄跟著晚一點出現的小標題與換語系更新，帶 #id 的網址打開時捲到那一段", async ({ page }) => {
    // 裝置量測的內容用到時才載入，小標題在第一次讀的時候還不在
    await page.goto("./bench/");
    const toc = page.getByTestId("aside-toc");
    await expect(toc.getByRole("link")).toHaveCount(6);
    await expect(toc.getByRole("link").first()).toHaveText(await page.locator("#bench-ocr-title").innerText());

    await page.goto("./testing/");
    await expect(toc.getByRole("link").first()).toHaveText("手機上的模型量測");
    await page.locator(".languages").getByRole("button", { name: "English" }).click();
    await expect(toc.getByRole("link").first()).toHaveText(await page.locator("#testing-phone").innerText());
    await expect(toc.getByRole("link").first()).not.toHaveText("手機上的模型量測");

    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("./testing/#testing-report");
    await expect.poll(async () => (await page.locator("#testing-report").boundingBox())!.y).toBeLessThan(300);
  });

  test("左欄比視窗長時，讀到的那一項留在左欄看得到的地方", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("./licenses/");
    const aside = page.getByTestId("page-aside");
    expect(await aside.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const current = page.getByTestId("aside-toc").locator('[aria-current="location"]');
    await expect(current).toHaveText("裝置量測的範例錄音");
    await expect(current).toBeInViewport();
  });

  test("英文版的左欄與目錄", async ({ page }) => {
    await page.goto("./en/licenses/");
    await expect(page.getByTestId("aside-tray")).toHaveText("The tray is empty.");
    await expect(page.getByTestId("aside-pages").getByRole("link", { name: "Licenses and sources" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("aside-toc").getByRole("link").first()).toHaveText("Gears itself");
  });

  test("跳到主內容：鍵盤移到左欄之前先出現，按下之後焦點移到右欄", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "WebKit 預設不用 Tab 移到連結");
    await page.goto("./samples/");
    const skip = page.getByRole("link", { name: "跳到主內容" });
    await expect(skip).toHaveCSS("position", "absolute");
    await skip.focus();
    await expect(skip).not.toHaveCSS("position", "absolute");
    await page.keyboard.press("Enter");
    await expect(page.locator("#page-content")).toBeFocused();
  });
});

test("窄螢幕不顯示左欄", async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("./licenses/");
  await expect(page.getByRole("heading", { level: 1, name: "授權與來源" })).toBeVisible();
  await expect(page.getByTestId("page-aside")).toHaveCount(0);
  // 視窗加寬之後出現
  if (!isMobile) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByTestId("page-aside")).toBeVisible();
  }
});

// 持久儲存：改寫 navigator.storage 的方法模擬各種瀏覽器的回覆。真的瀏覽器上 Chromium 依使用情況自行決定、
// Firefox 跳出詢問，測試裡無法操作，所以一律模擬
type Mode = "already" | "granted" | "denied" | "failed" | "pending" | "unsupported";

async function mockStorage(page: Page, mode: Mode) {
  await page.addInitScript((mode) => {
    if (mode === "unsupported") {
      Object.defineProperty(Navigator.prototype, "storage", { get: () => undefined, configurable: true });
      return;
    }
    // 改在原型上：WebKit 改寫 navigator.storage 這個物件本身的方法時，persist() 仍然呼叫到原本的
    let persisted = mode === "already";
    const define = (name: string, value: unknown) => Object.defineProperty(StorageManager.prototype, name, { value, configurable: true });
    define("estimate", async () => ({ usage: 5_000_000, quota: 2_000_000_000 }));
    define("persisted", async () => persisted);
    define("persist", () => {
      if (mode === "pending") return new Promise(() => {});
      if (mode === "failed") return Promise.reject(new Error("mock"));
      persisted = mode === "granted";
      return Promise.resolve(persisted);
    });
  }, mode);
}

test.describe("已下載的模型：這個網站的儲存空間", () => {
  test("用量與上限，還不是持久儲存時說明原因，申請成功之後按鈕消失", async ({ page, isMobile }) => {
    await mockStorage(page, "granted");
    await page.goto("./storage/");
    const quota = page.getByTestId("storage-quota");
    await expect(quota).toHaveCount(1);
    // 寬螢幕在左欄，手機在頁面本身
    await expect(page.getByTestId("page-aside").getByTestId("storage-quota")).toHaveCount(isMobile ? 0 : 1);
    await expect(page.getByTestId("storage-usage")).toContainText("已使用 5 MB，瀏覽器分給這個網站的空間約 2.0 GB。");
    await expect(quota).toContainText("標點模型約 148 MB、個資模型約 200 MB");
    await expect(quota).toContainText("Firefox 會跳出權限詢問");
    await quota.getByRole("button", { name: "申請持久儲存" }).click();
    await expect(page.getByTestId("storage-persist-status")).toHaveText("申請成功，空間不夠時瀏覽器不會自動清掉模型。要釋出空間時，在這一頁刪除。");
    await expect(quota.getByRole("button")).toHaveCount(0);
  });

  test("已經是持久儲存時不放按鈕", async ({ page }) => {
    await mockStorage(page, "already");
    await page.goto("./storage/");
    await expect(page.getByTestId("storage-persist-state")).toHaveText("這個網站已經是持久儲存，空間不夠時瀏覽器不會自動清掉模型。要釋出空間時，在這一頁刪除。");
    await expect(page.getByTestId("storage-persist")).toHaveCount(0);
  });

  test("瀏覽器拒絕時說明各家瀏覽器的做法，按鈕留著可以再試", async ({ page }) => {
    await mockStorage(page, "denied");
    await page.goto("./storage/");
    await page.getByTestId("storage-persist").click();
    await expect(page.getByTestId("storage-persist-status")).toContainText("瀏覽器沒有同意這次申請。");
    await expect(page.getByTestId("storage-persist-status")).toContainText("Tor Browser 與私密瀏覽通常一律拒絕");
    await expect(page.getByTestId("storage-persist")).toBeEnabled();
  });

  test("等待瀏覽器回覆時說明，按鈕仍然可以再按（詢問被關掉時的出口），申請出錯時說明", async ({ page }) => {
    await mockStorage(page, "pending");
    await page.goto("./storage/");
    await page.getByTestId("storage-persist").click();
    await expect(page.getByTestId("storage-quota")).toContainText("等待瀏覽器回覆…Firefox 會在網址列下方跳出詢問");
    await expect(page.getByTestId("storage-quota")).toContainText("可以再按一次");
    await expect(page.getByTestId("storage-persist")).toBeEnabled();
    await page.getByTestId("storage-persist").click();
    await expect(page.getByTestId("storage-quota")).toContainText("等待瀏覽器回覆…");

    await mockStorage(page, "failed");
    await page.reload();
    await page.getByTestId("storage-persist").click();
    await expect(page.getByTestId("storage-persist-status")).toHaveText("瀏覽器沒有回覆申請的結果。模型仍然可以使用，只是空間不夠時可能被清掉。");
  });

  test("瀏覽器不支援時說明，不顯示用量與按鈕", async ({ page }) => {
    await mockStorage(page, "unsupported");
    await page.goto("./storage/");
    await expect(page.getByTestId("storage-persist-state")).toContainText("這個瀏覽器不支援申請持久儲存。");
    await expect(page.getByTestId("storage-usage")).toHaveCount(0);
    await expect(page.getByTestId("storage-persist")).toHaveCount(0);
  });

  test("窄螢幕放在頁面本身，左欄與頁面不會同時出現", async ({ page, isMobile }) => {
    if (!isMobile) await page.setViewportSize({ width: 800, height: 900 });
    await mockStorage(page, "denied");
    await page.goto("./storage/");
    await expect(page.getByRole("heading", { level: 2, name: "這個網站的儲存空間" })).toBeVisible();
    await expect(page.getByTestId("storage-quota")).toHaveCount(1);
    if (!isMobile) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.getByTestId("page-aside").getByTestId("storage-quota")).toBeVisible();
      await expect(page.getByTestId("storage-quota")).toHaveCount(1);
    }
  });
});
