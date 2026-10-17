import type { Page } from "@playwright/test";
import { downloadFrom, expect, test } from "./guard.ts";
import { indexOf, sniff } from "../../src/core/bytes.ts";
import { parseExif } from "../../src/tools/strip-metadata/exif.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { exifSegment, insertIntoJpeg, insertIntoPng, metadataChunks, sampleTiff, bytes as text } from "../helpers/fixtures.ts";
import { concat } from "../../src/core/bytes.ts";

// 在遮蔽的畫布上框出一個範圍。用鍵盤操作，跟版面的高度無關：用滑鼠拖拉時，畫布底下可能被
// 固定在畫面底部的完成列蓋住，CI 沒有中文字型、版面高度跟本機不同，拖拉的位置會落在完成列底下
async function drawBox(page: Page) {
  await page.getByRole("application", { name: "要遮蔽的圖片" }).focus();
  await page.keyboard.press("Enter"); // 出現游標
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Enter"); // 第一個角
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

// 在瀏覽器裡用 canvas 畫一張真的可以解碼的圖，回到 Node 再塞進中繼資料
async function canvasImage(page: Page, type: "image/jpeg" | "image/png"): Promise<Uint8Array> {
  const data = await page.evaluate(async (mime) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#c33";
    g.fillRect(0, 0, 64, 48);
    g.fillStyle = "#3a3";
    g.fillRect(0, 0, 32, 24);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), mime, 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, type);
  return new Uint8Array(data);
}

async function addFile(page: Page, name: string, mimeType: string, data: Uint8Array) {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType, buffer: Buffer.from(data) });
}

async function download(page: Page): Promise<Uint8Array> {
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toMatch(/^gears-1\.(jpg|png)$/);
  return file.data;
}

async function previewLoaded(page: Page) {
  const img = page.locator(".preview img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
}

test("桌面有暫存區、任務捷徑與兩組工具，沒有檔案時不顯示清空按鈕", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "檔案工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暫存區" })).toBeVisible();
  await expect(page.getByRole("button", { name: /照片與影片的拍攝位置/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /給朋友的 Wi-Fi 密碼/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "交出去之前" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "安全地傳送" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "檢查收到的" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清空暫存區" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "回到桌面" })).toHaveCount(0);
});

test("JPEG：找出位置、清除、下載，旋轉方向保留", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff(6)));
  const withTrailer = concat([jpeg, text("MOTION-PHOTO-SECRET")]);
  await addFile(page, "IMG_20261014_093000.jpg", "image/jpeg", withTrailer);

  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  await expect(page.getByText("25.03300, 121.56540")).toBeVisible();
  await expect(page.getByText("TestMaker SECRET-MODEL")).toBeVisible();
  await previewLoaded(page);

  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  await expect(page.getByText("EXIF：位置、手機型號、拍攝時間與縮圖")).toBeVisible();
  await expect(page.getByText("旋轉方向，直拍的照片才不會變成橫的")).toBeVisible();
  await previewLoaded(page);

  const out = await download(page);
  expect(sniff(out)).toBe("jpeg");
  expect((await stripMetadata.inspect(out, "jpeg"))).toEqual([]);
  expect(Buffer.from(out).includes("MOTION-PHOTO-SECRET")).toBe(false);
  const exifAt = indexOf(out, "Exif\0\0");
  expect(parseExif(out.subarray(exifAt + 6)).orientation).toBe(6);
});

test("退回上一步，再清空暫存區", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, "photo.jpg", "image/jpeg", jpeg);
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();

  await page.getByRole("button", { name: "退回上一步" }).click();
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "退回上一步" })).toHaveCount(0);

  // 第一次按下只是確認，檔案還在
  await page.getByRole("button", { name: "清空暫存區" }).click();
  await expect(page.locator(".tray .item")).toHaveCount(1);
  await page.getByRole("button", { name: "再按一次清空" }).click();
  await expect(page.getByRole("button", { name: /照片與影片的拍攝位置/ })).toBeVisible();
  await expect(page.locator(".tray .item")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "選擇檔案" })).toBeVisible();
});

test("清空暫存區的確認幾秒內沒有再按就恢復，檔案留著", async ({ page }) => {
  await page.clock.install();
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.getByRole("button", { name: "清空暫存區" }).click();
  await expect(page.getByRole("button", { name: "再按一次清空" })).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.getByRole("button", { name: "清空暫存區" })).toBeVisible();
  await expect(page.getByText("notes.txt").first()).toBeVisible();
});

test("PNG：文字欄位與 eXIf 一起拿掉", async ({ page }) => {
  const png = insertIntoPng(await canvasImage(page, "image/png"), ...metadataChunks());
  await addFile(page, "screenshot.png", "image/png", png);
  await expect(page.getByText("作者或擁有者的名字")).toBeVisible();
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  await previewLoaded(page);

  const out = await download(page);
  expect(sniff(out)).toBe("png");
  expect((await stripMetadata.inspect(out, "png"))).toEqual([]);
  expect(Buffer.from(out).includes("Jane Doe")).toBe(false);
});

test("一次加入多個檔案，可以在暫存區切換", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  const png = await canvasImage(page, "image/png");
  await page.getByTestId("file-input").setInputFiles([
    { name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) },
    { name: "b.png", mimeType: "image/png", buffer: Buffer.from(png) },
  ]);
  await expect(page.locator(".tray .item")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "a.jpg" })).toBeVisible();
  await page.getByRole("button", { name: /^b\.png/ }).click();
  await expect(page.getByRole("heading", { name: "b.png" })).toBeVisible();
  // 移除其中一個，另一個留著
  await page.getByRole("button", { name: "從暫存區移除：b.png" }).click();
  await expect(page.locator(".tray .item")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "a.jpg" })).toBeVisible();
});

test("很長的檔名不會把版面撐出橫向捲軸", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, `IMG_20261014_093000_${"very_long_name_".repeat(6)}.jpg`, "image/jpeg", jpeg);
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("不能預覽的檔案說明清楚，只提供加密", async ({ page }) => {
  await addFile(page, "notes.txt", "text/plain", text("hello"));
  await expect(page.getByText("這種檔案還沒有辦法檢查裡面的中繼資料")).toBeVisible();
  await expect(page.locator(".tray .item")).toContainText("不能預覽");
  await expect(page.getByRole("button", { name: "清除", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "開始加密" })).toBeVisible();
});

test("正式建置帶著 CSP，限制頁面能連線的對象", async ({ page, guard }) => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'self'");
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/", { method: "POST", body: "x" });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  // CSP 擋下時瀏覽器會在主控台留下錯誤，這裡是預期中的
  guard.errors = [];
  guard.requests = guard.requests.filter((url) => !url.startsWith("https://example.com"));
});

test("做了第二個工具之後，前面處理過的仍標示已處理", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, "photo.jpg", "image/jpeg", jpeg);
  const strip = page.locator(".shelf li", { hasText: "清除中繼資料" });
  const redact = page.locator(".shelf li", { hasText: "遮蔽" });
  await expect(strip.getByText("建議")).toBeVisible();
  await strip.getByRole("button", { name: "清除", exact: true }).click();

  await expect(strip.getByText("已處理")).toBeVisible();
  await expect(strip.getByRole("button")).toHaveCount(0);
  await redact.getByRole("button", { name: "開始框選" }).click();
  await drawBox(page);
  await page.getByRole("button", { name: "套用遮蔽" }).click();

  // 兩個工具都標示已處理，遮蔽可以再框一次。清除之後已經沒有中繼資料，遮蔽這一步不用再說明
  await expect(page.getByTestId("removed-note")).toHaveCount(0);
  await expect(strip.getByText("已處理")).toBeVisible();
  await expect(redact.getByText("已處理")).toBeVisible();
  await expect(redact.getByRole("button", { name: "再框選一次" })).toBeVisible();

  // 退回上一步，遮蔽的版本拿掉，已處理也跟著消失
  await page.getByRole("button", { name: "退回上一步" }).click();
  await expect(redact.getByText("已處理")).toHaveCount(0);
  await expect(redact.getByRole("button", { name: "開始框選" })).toBeVisible();
  await expect(strip.getByText("已處理")).toBeVisible();
});

test("先遮蔽：說明中繼資料是重新產生整張圖時一起拿掉的", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, "photo.jpg", "image/jpeg", jpeg);
  await page.getByRole("button", { name: "開始框選" }).click();
  await drawBox(page);
  await page.getByRole("button", { name: "套用遮蔽" }).click();

  const note = page.getByTestId("removed-note");
  await expect(note).toContainText("上一步（遮蔽）拿掉了原本找到的 7 項資訊。遮蔽時重新產生了整張圖");
  // 已經沒有中繼資料，清除中繼資料不顯示按鈕
  const strip = page.locator(".shelf li", { hasText: "清除中繼資料" });
  await expect(strip.getByRole("button")).toHaveCount(0);
  await expect(strip.getByText("目前沒有需要清除的")).toBeVisible();
  await expect(note).toContainText("遮蔽時重新產生了整張圖");
});

test("手機點過頁首的 logo 之後，名稱底下不會留著底線", async ({ page, isMobile }) => {
  test.skip(!isMobile, "觸控裝置點過之後 :hover 會一直留著");
  await page.goto("./qrcode/");
  await page.locator(".site-header__logo").tap();
  await expect(page.getByRole("heading", { name: "常見的情況" })).toBeVisible();
  await expect(page.locator(".site-header__product")).toHaveCSS("text-decoration-line", "none");
});

test("暫存區有檔案時，不會因為往下拉而重新整理，離開前要確認；清空之後恢復", async ({ page, browserName }) => {
  const overscroll = () => page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
  expect(await overscroll()).toBe("auto");
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, "photo.jpg", "image/jpeg", jpeg);
  await expect(page.locator(".tray .item")).toHaveCount(1);
  await expect.poll(overscroll).toBe("none");

  // 離開前的確認要有讀者的操作過才會出現，Chromium 才測得到
  if (browserName === "chromium") {
    await page.getByRole("button", { name: "清除", exact: true }).click();
    const dialog = page.waitForEvent("dialog");
    void page.close({ runBeforeUnload: true });
    const d = await dialog;
    expect(d.type()).toBe("beforeunload");
    await d.dismiss();
    expect(page.isClosed()).toBe(false);
  }

  await page.getByRole("button", { name: "清空暫存區" }).click();
  await page.getByRole("button", { name: "再按一次清空" }).click();
  await expect(page.locator(".tray .item")).toHaveCount(0);
  await expect.poll(overscroll).toBe("auto");
});

test("暫存區有檔案、頁面在最上面時，手指往下拉的手勢被攔下", async ({ page }) => {
  const supported = await page.evaluate(() => "ontouchstart" in window);
  test.skip(!supported, "這個瀏覽器不能自己產生觸控事件");
  // 從 y1 拉到 y2，回傳 touchmove 有沒有被攔下
  const pull = (y1: number, y2: number) =>
    page.evaluate(
      ([a, b]) => {
        const target = document.querySelector("main") ?? document.body;
        // Chromium 用 Touch 建構子，WebKit 只有舊的 document.createTouch
        const doc = document as Document & { createTouch?: (...args: unknown[]) => Touch; createTouchList?: (...t: Touch[]) => TouchList };
        const touch = (y: number): Touch => {
          try {
            return new Touch({ identifier: 1, target, clientX: 100, clientY: y });
          } catch {
            return doc.createTouch!(window, target, 1, 100, y, 100, y);
          }
        };
        const list = (t: Touch) => (doc.createTouchList ? doc.createTouchList(t) : [t]) as unknown as Touch[];
        const event = (type: string, t: Touch) => {
          try {
            return new TouchEvent(type, { touches: list(t), bubbles: true, cancelable: true });
          } catch {
            const e = document.createEvent("TouchEvent") as TouchEvent & { initTouchEvent: (...args: unknown[]) => void };
            e.initTouchEvent(type, true, true, window, 0, 0, 0, 0, 0, false, false, false, false, list(t), list(t), list(t), 1, 0);
            return e;
          }
        };
        target.dispatchEvent(event("touchstart", touch(a)));
        const move = event("touchmove", touch(b));
        target.dispatchEvent(move);
        target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true }));
        return move.defaultPrevented;
      },
      [y1, y2],
    );
  expect(await pull(100, 200)).toBe(false); // 暫存區是空的
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, "photo.jpg", "image/jpeg", jpeg);
  await expect(page.locator(".tray .item")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => pull(100, 200)).toBe(true); // 在最上面往下拉
  expect(await pull(200, 100)).toBe(false); // 往上捲
  await page.evaluate(() => window.scrollTo(0, 200));
  if (await page.evaluate(() => window.scrollY > 0)) expect(await pull(100, 200)).toBe(false); // 頁面不在最上面
});

test("首頁按清空變成紅底確認時，按鈕不會貼到頁首的底線", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, "photo.jpg", "image/jpeg", jpeg);
  await page.locator(".site-header__home").click();
  await page.getByRole("button", { name: "清空暫存區" }).click();
  const armed = (await page.getByRole("button", { name: "再按一次清空" }).boundingBox())!;
  const header = (await page.locator(".site-header").boundingBox())!;
  expect(header.y + header.height - (armed.y + armed.height)).toBeGreaterThanOrEqual(4);
});
