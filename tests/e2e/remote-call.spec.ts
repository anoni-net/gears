import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./guard.ts";
import { startSender } from "./remote-helpers.ts";

// 遠端傳送的視訊通話（src/tools/remote/call.ts）。Chromium 用假的相機與麥克風，測試的轉送服務允許
// 區網的位址（RELAY_TEST_ICE=all），同一台機器上連得起來。其他核心沒有對應的假裝置，略過
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
test.skip(({ browserName }) => browserName !== "chromium", "假的相機與麥克風只在 Chromium 設定");

// late：對方過一陣子才加入。伺服器配對之後才發 TURN 設定，送出端要等到配對完成
async function connected(browser: Browser, baseURL: string, late = false) {
  const permissions = ["camera", "microphone"];
  const a = await browser.newContext({ baseURL, permissions });
  const b = await browser.newContext({ baseURL, permissions });
  const sender = await a.newPage();
  const receiver = await b.newPage();
  const link = await startSender(sender);
  if (late) await sender.waitForTimeout(6000);
  await receiver.goto(link);
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-call-start")).toBeVisible({ timeout: 20_000 });
  await expect(sender.getByTestId("remote-call-start")).toBeVisible();
  return { sender, receiver, close: () => Promise.all([a.close(), b.close()]) };
}

const playing = (page: Page, testid: string) =>
  expect.poll(() => page.getByTestId(testid).evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && !v.paused), { timeout: 20_000 }).toBe(true);

test("一端邀請、另一端接聽，兩端都看得到對方的畫面，關掉鏡頭之後掛斷", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await connected(browser, baseURL!);
  await sender.getByTestId("remote-call-start").click();
  await expect(sender.getByTestId("remote-call-status")).toHaveText("等對方接聽…");
  await expect(receiver.getByTestId("remote-call-status")).toHaveText("對方邀請你視訊通話。");
  await receiver.getByTestId("remote-call-accept").click();
  for (const page of [sender, receiver]) {
    await expect(page.getByTestId("remote-call-status")).toHaveAttribute("data-state", "live", { timeout: 20_000 });
    await playing(page, "remote-video-peer");
    await playing(page, "remote-video-self");
  }
  await expect(sender.getByTestId("remote-call-cam")).toHaveText("關閉鏡頭");
  await sender.getByTestId("remote-call-cam").click();
  await expect(sender.getByTestId("remote-call-cam")).toHaveText("開啟鏡頭");
  await sender.getByTestId("remote-call-mic").click();
  await expect(sender.getByTestId("remote-call-mic")).toHaveText("開啟麥克風");
  // 通話中文字訊息照樣送得到
  await receiver.getByTestId("remote-chat-input").fill("聽得到嗎");
  await receiver.getByTestId("remote-chat-input").press("Enter");
  await expect(sender.getByTestId("remote-messages")).toContainText("聽得到嗎");

  await receiver.getByTestId("remote-call-hangup").click();
  await expect(receiver.getByTestId("remote-call-ended")).toHaveText("通話已經結束。");
  await expect(sender.getByTestId("remote-call-ended")).toHaveText("對方已經掛斷，通話結束。");
  // 掛斷之後相機與麥克風都停掉了，可以再打一次
  await expect(sender.getByTestId("remote-video-self")).toHaveCount(0);
  await receiver.getByTestId("remote-call-start").click();
  await expect(sender.getByTestId("remote-call-status")).toHaveText("對方邀請你視訊通話。");
  await sender.getByTestId("remote-call-decline").click();
  await expect(receiver.getByTestId("remote-call-ended")).toHaveText("對方拒絕了通話。");
  await close();
});

test("兩端同時按下視訊通話，只接通一通", async ({ browser, baseURL }) => {
  // 對方超過 5 秒才加入，送出端一樣可以視訊
  const { sender, receiver, close } = await connected(browser, baseURL!, true);
  await Promise.all([sender.getByTestId("remote-call-start").click(), receiver.getByTestId("remote-call-start").click()]);
  for (const page of [sender, receiver]) {
    await expect(page.getByTestId("remote-call-status")).toHaveAttribute("data-state", "live", { timeout: 20_000 });
    await playing(page, "remote-video-peer");
  }
  await sender.getByTestId("remote-call-hangup").click();
  await expect(receiver.getByTestId("remote-call-ended")).toHaveText("對方已經掛斷，通話結束。");
  await close();
});
