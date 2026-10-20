import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 遠端傳送：送出端與接收端各開一個 context（不同的人），經過 playwright.config.ts 起的轉送服務，
// 預覽伺服器把 /gears/relay/ 轉過去。斷線接回來的情境在單元測試（tests/unit/remote-session.spec.ts）

const random = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7919 + (i >> 8)) & 255));

// 送出端：暫存區放兩個檔案，打開遠端傳送，產生連結，回傳分享連結
async function startSender(page: Page): Promise<string> {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("遠端傳送的測試\n".repeat(50)) },
    { name: "data.bin", mimeType: "application/octet-stream", buffer: random },
  ]);
  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByRole("button", { name: /^遠端傳送/ }).click();
  await page.getByRole("button", { name: "送出暫存區的檔案" }).click();
  await expect(page.getByTestId("remote-privacy")).toContainText("Cloudflare");
  await page.getByRole("button", { name: "產生連結（2 個檔案）" }).click();
  await expect(page.getByTestId("remote-status")).toContainText("等對方打開連結");
  return page.getByTestId("remote-link").inputValue();
}

async function people(browser: Browser, baseURL: string) {
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  return { sender: await a.newPage(), receiver: await b.newPage(), close: () => Promise.all([a.close(), b.close()]) };
}

test("打開分享連結、按加入，兩端的確認碼相同，接收之後放進暫存區", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await people(browser, baseURL!);
  const link = await startSender(sender);
  expect(link).toMatch(/\/gears\/remote\/#r=[A-Za-z0-9_-]{22}&k=[A-Za-z0-9_-]{43}$/);
  // clearnet 的頁面另外給 onion 的連結，# 後面相同
  const onion = await sender.getByTestId("remote-onion-link").inputValue();
  expect(onion).toMatch(/^http:\/\/gears\.[a-z2-7]{56}\.onion\/remote\/#/);
  expect(onion.split("#")[1]).toBe(link.split("#")[1]);

  // 打開連結不自動連線，讀完 # 就從網址清掉
  await receiver.goto(link);
  await expect(receiver.getByTestId("remote-status")).toContainText("按「加入」之後才會連線");
  expect(new URL(receiver.url()).hash).toBe("");
  await expect(receiver.getByTestId("remote-privacy")).toContainText("看不到內容");
  await receiver.getByRole("button", { name: "加入", exact: true }).click();

  await expect(receiver.getByTestId("remote-incoming").locator("li")).toHaveCount(2, { timeout: 20_000 });
  await expect(receiver.getByTestId("remote-incoming")).toContainText("gears-1.txt");
  const code = await receiver.getByTestId("remote-confirm").locator("strong").innerText();
  expect(code).toMatch(/^\d{3} \d{3}$/);
  await expect(sender.getByTestId("remote-confirm").locator("strong")).toHaveText(code);
  await expect(sender.getByTestId("remote-status")).toContainText("等對方決定");

  await receiver.getByRole("button", { name: "接收", exact: true }).click();
  await expect(receiver.getByTestId("remote-status")).toHaveText("收到 2 個檔案，SHA-256 都對得上，已經放進暫存區。", { timeout: 30_000 });
  await expect(sender.getByTestId("remote-status")).toHaveText("2 個檔案都送到了，對方核對過 SHA-256。");
  await expect(receiver.locator("section.tray li")).toHaveCount(2);
  await close();
});

test("貼上收到的連結也能加入，接收端拒絕時送出端說明沒有傳任何檔案", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await people(browser, baseURL!);
  const link = await startSender(sender);
  await receiver.goto("./remote/");
  await receiver.getByTestId("remote-paste").fill("不是連結");
  await receiver.getByRole("button", { name: "套用" }).click();
  await expect(receiver.getByText("這不是遠端傳送的連結")).toBeVisible();
  // 只要 # 後面對就好，onion 的連結也能貼進 clearnet 的頁面
  await receiver.getByTestId("remote-paste").fill(`http://gears.example.onion/remote/#${link.split("#")[1]}`);
  await receiver.getByRole("button", { name: "套用" }).click();
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-incoming").locator("li")).toHaveCount(2, { timeout: 20_000 });
  await receiver.getByRole("button", { name: "拒絕" }).click();
  await expect(sender.getByTestId("remote-status")).toHaveText("這次的傳送取消了，沒有傳任何檔案。");
  await close();
});

test("連結的金鑰不對時說明連結不完整，用過的連結不能再用", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await people(browser, baseURL!);
  const link = await startSender(sender);
  // 金鑰換掉一個字元：伺服器配得起來，握手時解不開
  const [head, key] = link.split("&k=");
  const wrong = `${head}&k=${key![0] === "A" ? "B" : "A"}${key!.slice(1)}`;
  await receiver.goto(wrong);
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-status")).toContainText("連結不完整", { timeout: 20_000 });

  // 房間已經配對過，同一個連結再加入一次
  const third = await (await browser.newContext({ baseURL })).newPage();
  await third.goto(link);
  await third.getByRole("button", { name: "加入", exact: true }).click();
  await expect(third.getByTestId("remote-status")).toContainText("連結已經用過", { timeout: 20_000 });
  await third.context().close();
  await close();
});
