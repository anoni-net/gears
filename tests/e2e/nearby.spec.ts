import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 面對面傳送：同一個瀏覽器開兩個分頁，一個送、一個收。分頁之間解析得到彼此的 mDNS 名稱，
// 不必真的兩台裝置。CI 沒有相機，走複製貼上與「打開送出端的網址」兩條路，鏡頭掃 QR code 那一條
// 跟 QR code 讀取共用同一套解碼。Firefox 不處理背景分頁的輸入，操作哪一個分頁之前先把它切到前景

// 送出端：暫存區放兩個檔案，打開面對面傳送，開始配對，回傳要給接收端的網址
async function startSender(page: Page): Promise<string> {
  await page.goto("./");
  const random = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7919 + (i >> 8)) & 255));
  await page.getByTestId("file-input").setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("面對面傳送的測試\n".repeat(50)) },
    { name: "data.bin", mimeType: "application/octet-stream", buffer: random },
  ]);
  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByRole("button", { name: /^面對面傳送/ }).click();
  await page.getByRole("button", { name: "送出暫存區的檔案" }).click();
  await page.getByRole("button", { name: "開始配對（2 個檔案）" }).click();
  await expect(page.getByTestId("nearby-status")).toContainText("掃這個 QR code");
  await page.getByText("沒有相機時").click();
  return page.getByTestId("nearby-code").inputValue();
}

async function finish(sender: Page, receiver: Page, answer: string) {
  await sender.bringToFront();
  await sender.getByTestId("nearby-paste").fill(answer);
  await sender.getByRole("button", { name: "套用" }).click();
  await expect(sender.getByTestId("nearby-status")).toContainText("等對方決定", { timeout: 20_000 });

  // 接收端先看到清單與確認碼，兩邊的確認碼相同
  await receiver.bringToFront();
  await expect(receiver.getByTestId("nearby-incoming").locator("li")).toHaveCount(2);
  await expect(receiver.getByTestId("nearby-incoming")).toContainText("gears-1.txt");
  const code = await receiver.getByTestId("nearby-confirm").locator("strong").innerText();
  expect(code).toMatch(/^\d{3} \d{3}$/);
  await expect(sender.getByTestId("nearby-confirm").locator("strong")).toHaveText(code);

  await receiver.getByRole("button", { name: "接收", exact: true }).click();
  await expect(receiver.getByTestId("nearby-status")).toHaveText("收到 2 個檔案，SHA-256 都對得上，已經放進暫存區。", { timeout: 30_000 });
  await sender.bringToFront();
  await expect(sender.getByTestId("nearby-status")).toHaveText("2 個檔案都送到了，對方核對過 SHA-256。");
  await expect(receiver.locator("section.tray li")).toHaveCount(2);
}

// 給相機權限：送出端先開相機再建立連線描述，Chromium 與 WebKit 才會交出區網位址，CI 的機器沒有
// mDNS 解析，只有 mDNS 名稱的話兩個分頁連不上。Firefox 不支援這項權限
async function pair(browser: Browser, baseURL: string) {
  const permissions = browser.browserType().name() === "firefox" ? [] : ["camera"];
  const context = await browser.newContext({ baseURL, permissions });
  const sender = await context.newPage();
  // GitHub 機器上的 Firefox 蒐集不到任何候選（2026-10-17 在 CI 上確認），連線建不起來，略過
  await sender.goto("./");
  const candidates = await sender.evaluate(async () => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("probe");
    await pc.setLocalDescription();
    await new Promise((r) => {
      pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(0);
      setTimeout(r, 3000);
    });
    const n = pc.localDescription!.sdp.split("\n").filter((l) => l.startsWith("a=candidate")).length;
    pc.close();
    return n;
  });
  test.skip(!candidates, "這個環境的瀏覽器蒐集不到 WebRTC 的候選");
  return { sender, receiver: await context.newPage(), context };
}

test("複製貼上配對，傳兩個檔案，接收端核對 SHA-256 之後放進暫存區", async ({ browser, baseURL }) => {
  const { sender, receiver, context } = await pair(browser, baseURL!);
  const offer = await startSender(sender);
  expect(offer).toMatch(/\/nearby\/#[A-Za-z0-9_-]+$/);

  await receiver.bringToFront();
  await receiver.goto("./nearby/");
  await receiver.getByRole("button", { name: "接收檔案" }).click();
  await receiver.getByTestId("nearby-paste").fill(offer);
  await receiver.getByRole("button", { name: "套用" }).click();
  await expect(receiver.getByTestId("nearby-status")).toContainText("讓送出端的鏡頭掃這個 QR code");
  await receiver.getByText("沒有相機時").click();
  const answer = await receiver.getByTestId("nearby-code").inputValue();
  await finish(sender, receiver, answer);
  await context.close();
});

test("接收端直接打開送出端的網址，自動帶入連線描述，網址的 # 隨即清掉", async ({ browser, baseURL }) => {
  const { sender, receiver, context } = await pair(browser, baseURL!);
  const offer = await startSender(sender);
  await receiver.bringToFront();
  await receiver.goto(offer);
  await expect(receiver.getByTestId("nearby-status")).toContainText("讓送出端的鏡頭掃這個 QR code");
  expect(new URL(receiver.url()).hash).toBe("");
  await receiver.getByText("沒有相機時").click();
  await finish(sender, receiver, await receiver.getByTestId("nearby-code").inputValue());
  await context.close();
});

test("接收端可以拒絕，送出端說明這次沒有傳任何檔案", async ({ browser, baseURL }) => {
  const { sender, receiver, context } = await pair(browser, baseURL!);
  const offer = await startSender(sender);
  await receiver.bringToFront();
  await receiver.goto(offer);
  await receiver.getByText("沒有相機時").click();
  const answer = await receiver.getByTestId("nearby-code").inputValue();
  await sender.bringToFront();
  await sender.getByTestId("nearby-paste").fill(answer);
  await sender.getByRole("button", { name: "套用" }).click();
  await expect(sender.getByTestId("nearby-status")).toContainText("等對方決定", { timeout: 20_000 });
  await receiver.bringToFront();
  await receiver.getByRole("button", { name: "拒絕" }).click();
  await sender.bringToFront();
  await expect(sender.getByTestId("nearby-status")).toHaveText("這次的傳送取消了，沒有傳任何檔案。", { timeout: 20_000 });
  await expect(receiver.locator("section.tray li")).toHaveCount(0);
  await context.close();
});

test("貼上不是工作台的代碼時說明，繼續等正確的代碼", async ({ page }) => {
  await page.goto("./nearby/");
  await page.getByRole("button", { name: "接收檔案" }).click();
  await page.getByTestId("nearby-paste").fill("https://example.com/menu");
  await page.getByRole("button", { name: "套用" }).click();
  await expect(page.getByText("掃到的不是本次配對的代碼")).toBeVisible();
  await expect(page.getByTestId("nearby-paste")).toBeVisible();
});

test("瀏覽器關掉 WebRTC 時（Tor Browser）說明，建議改用 OnionShare", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis, "RTCPeerConnection", { value: undefined, configurable: true }));
  await page.goto("./nearby/");
  await expect(page.getByRole("alert")).toContainText("OnionShare");
});

test("找不到區網位址時說明要先連上 Wi-Fi 或熱點", async ({ page }) => {
  // 把自己這一側描述裡的候選拿掉，模擬沒有連上任何網路
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, "localDescription")!.get!;
    Object.defineProperty(RTCPeerConnection.prototype, "localDescription", {
      get(this: RTCPeerConnection) {
        const d = original.call(this) as RTCSessionDescription | null;
        return d && { type: d.type, sdp: d.sdp.replace(/^a=candidate:.*\r?\n/gm, "") };
      },
    });
  });
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "n.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByRole("button", { name: /^面對面傳送/ }).click();
  await page.getByRole("button", { name: "送出暫存區的檔案" }).click();
  await page.getByRole("button", { name: "開始配對（1 個檔案）" }).click();
  await expect(page.getByTestId("nearby-status")).toContainText("找不到這台裝置的區網位址");
});

test("在面對面傳送的畫面加入檔案，留在原畫面並預設勾選；可以保留原本的檔名", async ({ browser, baseURL }) => {
  const { sender, receiver, context } = await pair(browser, baseURL!);
  await sender.goto("./nearby/");
  await sender.getByTestId("file-input").setInputFiles({ name: "2026-10-17 訪談.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  // 處理整個暫存區的工具：加入檔案之後不跳到單一檔案的畫面
  await expect(sender).toHaveURL(/\/nearby\/$/);
  await sender.getByRole("button", { name: "送出暫存區的檔案" }).click();
  await expect(sender.getByText("gears-1.txt")).toBeVisible();
  await sender.getByTestId("nearby-keep-names").check();
  await expect(sender.getByText("2026-10-17 訪談.txt").last()).toBeVisible();
  await sender.getByRole("button", { name: "開始配對（1 個檔案）" }).click();
  await sender.getByText("沒有相機時").click();
  const offer = await sender.getByTestId("nearby-code").inputValue();
  await receiver.bringToFront();
  await receiver.goto(offer);
  await receiver.getByText("沒有相機時").click();
  const answer = await receiver.getByTestId("nearby-code").inputValue();
  await sender.bringToFront();
  await sender.getByTestId("nearby-paste").fill(answer);
  await sender.getByRole("button", { name: "套用" }).click();
  await receiver.bringToFront();
  await expect(receiver.getByTestId("nearby-incoming")).toContainText("2026-10-17 訪談.txt", { timeout: 20_000 });
  await context.close();
});

test("接收端的頁面已經開著，打開送出端的網址（只有 # 後面不同）也會讀到", async ({ browser, baseURL }) => {
  const { sender, receiver, context } = await pair(browser, baseURL!);
  const offer = await startSender(sender);
  await receiver.bringToFront();
  await receiver.goto("./nearby/");
  await receiver.goto(offer);
  await expect(receiver.getByTestId("nearby-status")).toContainText("讓送出端的鏡頭掃這個 QR code");
  await context.close();
});
