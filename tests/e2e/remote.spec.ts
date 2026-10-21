import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { FILES_OVER_DIRECT } from "../../src/tools/remote/direct.ts";
import { expect, test } from "./guard.ts";
import { startSender } from "./remote-helpers.ts";

// 遠端傳送：送出端與接收端各開一個 context（不同的人），經過 playwright.config.ts 起的轉送服務，
// 預覽伺服器把 /gears/relay/ 轉過去。斷線接回來的情境在單元測試（tests/unit/remote-session.spec.ts）

// 給相機權限：Chromium 與 WebKit 有了權限才交出區網位址，CI 的機器沒有 mDNS 解析，
// 只有 mDNS 名稱的話資料通道打不開（同面對面傳送的測試）。Firefox 不支援這項權限
async function people(browser: Browser, baseURL: string) {
  const permissions = browser.browserType().name() === "firefox" ? [] : ["camera"];
  const a = await browser.newContext({ baseURL, permissions });
  const b = await browser.newContext({ baseURL, permissions });
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
  await expect(receiver.getByTestId("remote-invite")).toContainText("按下「加入」才會連線");
  expect(new URL(receiver.url()).hash).toBe("");
  // 誰看得到什麼的對照表：中繼伺服器與 Cloudflare 看不到內容，對方看不到你的 IP
  const who = receiver.getByTestId("remote-who");
  await expect(who.locator("thead th")).toHaveText(["中繼伺服器", "Cloudflare", "對方"]);
  await expect(who.locator("tbody tr").nth(0).locator("td")).toHaveText(["看得到", "看得到", "看不到"]);
  await expect(who.locator("tbody tr").nth(2).locator("td")).toHaveText(["看不到", "看不到", "看得到"]);
  await receiver.getByRole("button", { name: "加入", exact: true }).click();

  await expect(receiver.getByTestId("remote-incoming").locator("li")).toHaveCount(2, { timeout: 20_000 });
  await expect(receiver.getByTestId("remote-incoming")).toContainText("gears-1.txt");
  const code = await receiver.getByTestId("remote-confirm").locator("strong").innerText();
  expect(code).toMatch(/^\d{3} \d{3}$/);
  await expect(sender.getByTestId("remote-confirm").locator("strong")).toHaveText(code);
  // 兩端都看得到核對的方式，提醒不要在這裡的文字訊息核對
  for (const page of [sender, receiver]) await expect(page.getByTestId("remote-confirm-note")).toContainText("不要在這裡的文字訊息核對");
  await expect(sender.getByTestId("remote-status")).toContainText("等對方決定");
  // 檔案預設走轉送服務。改走資料通道時，測試的轉送服務允許區網的位址（RELAY_TEST_ICE=all），
  // Chromium 打得開資料通道，其他核心在 CI 上可能蒐集不到候選，逾時之後走轉送服務，一樣要傳得完
  if (!FILES_OVER_DIRECT) await expect(receiver.getByTestId("remote-via")).toHaveAttribute("data-via", "relay");
  else if (browser.browserType().name() === "chromium") await expect(receiver.getByTestId("remote-via")).toHaveAttribute("data-via", "direct");

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

// 在網址列貼上連結：頁面已經開著時只有 # 後面變了，不會重新載入
const pasteInAddressBar = (page: Page, link: string) => page.evaluate((url) => (location.href = url), link);

test("上一個連結出錯之後，在同一個分頁貼上新的連結也接得住", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await people(browser, baseURL!);
  await receiver.goto(`./remote/#r=${"A".repeat(22)}&k=${"A".repeat(43)}`);
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-status")).toContainText("連結已經用過");
  const link = await startSender(sender);
  await pasteInAddressBar(receiver, link);
  await expect(receiver.getByTestId("remote-invite")).toContainText("按下「加入」才會連線");
  expect(new URL(receiver.url()).hash).toBe("");
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-incoming").locator("li")).toHaveCount(2, { timeout: 20_000 });
  await close();
});

test("傳送進行中貼上另一個連結時先問讀者，可以改用新的連結", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await people(browser, baseURL!);
  const first = await startSender(sender);
  await receiver.goto(first);
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-incoming").locator("li")).toHaveCount(2, { timeout: 20_000 });

  const other = await browser.newContext({ baseURL });
  const second = await startSender(await other.newPage());
  await pasteInAddressBar(receiver, second);
  await expect(receiver.getByTestId("remote-pending")).toBeVisible();
  // 先選繼續，畫面留在原本的清單
  await receiver.getByRole("button", { name: "繼續目前的傳送" }).click();
  await expect(receiver.getByTestId("remote-pending")).toHaveCount(0);
  await expect(receiver.getByTestId("remote-incoming")).toBeVisible();
  // 再貼一次，改用新的連結
  await pasteInAddressBar(receiver, second);
  await receiver.getByRole("button", { name: "改用新的連結" }).click();
  await expect(receiver.getByTestId("remote-invite")).toContainText("按下「加入」才會連線");
  // 原本的送出端收到對方離開
  await expect(sender.getByTestId("remote-status")).toContainText("對方已經離開", { timeout: 20_000 });
  await other.close();
  await close();
});

test("連上之後兩端可以互傳文字訊息，傳完檔案之後也可以，結束連線之後對方看得到", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await people(browser, baseURL!);
  const link = await startSender(sender);
  await receiver.goto(link);
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-incoming").locator("li")).toHaveCount(2, { timeout: 20_000 });

  // 接收之前先問一句
  await receiver.getByTestId("remote-chat-input").fill("這兩個檔案是什麼？");
  await receiver.getByRole("button", { name: "送出", exact: true }).click();
  await expect(sender.getByTestId("remote-messages")).toContainText("這兩個檔案是什麼？");
  // Enter 也能送出
  await sender.getByTestId("remote-chat-input").fill("上次說的資料");
  await sender.getByTestId("remote-chat-input").press("Enter");
  await expect(receiver.getByTestId("remote-messages")).toContainText("上次說的資料");
  await expect(receiver.getByTestId("remote-chat-input")).toHaveValue("");

  await receiver.getByRole("button", { name: "接收", exact: true }).click();
  await expect(receiver.getByTestId("remote-status")).toContainText("收到 2 個檔案", { timeout: 30_000 });
  // 傳完之後連線還在
  await sender.getByTestId("remote-chat-input").fill("收到了嗎");
  await sender.getByRole("button", { name: "送出", exact: true }).click();
  await expect(receiver.getByTestId("remote-messages")).toContainText("收到了嗎");
  // 確認碼、清單與文字訊息都在畫面上時的無障礙檢查，結果跟瀏覽器無關，只在 Chromium 跑
  if (browser.browserType().name() === "chromium") {
    const result = await new AxeBuilder({ page: receiver }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }

  // 結束連線先問一次，焦點停在「繼續連線」，按 Enter 不會斷線
  await receiver.getByRole("button", { name: "結束連線" }).click();
  await expect(receiver.getByTestId("remote-end-ask")).toContainText("要結束連線嗎？");
  await expect(receiver.getByRole("button", { name: "繼續連線" })).toBeFocused();
  await receiver.keyboard.press("Enter");
  await expect(receiver.getByTestId("remote-end-ask")).toHaveCount(0);
  await receiver.getByTestId("remote-chat-input").fill("還在");
  await receiver.getByTestId("remote-chat-input").press("Enter");
  await expect(sender.getByTestId("remote-messages")).toContainText("還在");
  await receiver.getByRole("button", { name: "結束連線" }).click();
  await receiver.getByTestId("remote-end-ask").getByRole("button", { name: "結束連線" }).click();
  await expect(receiver.getByTestId("remote-ended")).toHaveText("連線已經結束。");
  await expect(sender.getByTestId("remote-ended")).toHaveText("對方已經結束連線。", { timeout: 20_000 });
  await close();
});

test("資料通道傳到一半斷掉，改用轉送服務重傳，接收端不必再按一次接收", async ({ browser, baseURL }) => {
  test.skip(!FILES_OVER_DIRECT, "檔案預設走轉送服務");
  test.skip(browser.browserType().name() !== "chromium", "資料通道只在 Chromium 一定打得開");
  const { sender, receiver, close } = await people(browser, baseURL!);
  // 記下送出端建立的 RTCPeerConnection，傳到一半把它關掉
  await sender.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    const all: RTCPeerConnection[] = [];
    (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = all;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        all.push(this);
      }
    } as typeof RTCPeerConnection;
  });
  await sender.goto("./");
  const big = Buffer.from(Array.from({ length: 24 * 1024 * 1024 }, (_, i) => (i * 131 + (i >> 10)) & 255));
  await sender.getByTestId("file-input").setInputFiles([{ name: "big.bin", mimeType: "application/octet-stream", buffer: big }]);
  await sender.getByRole("button", { name: "回到桌面" }).click();
  await sender.getByRole("button", { name: /^遠端傳送/ }).click();
  await sender.getByRole("button", { name: "送出暫存區的檔案" }).click();
  await sender.getByRole("button", { name: "產生連結（1 個檔案）" }).click();
  await expect(sender.getByTestId("remote-status")).toContainText("等對方打開連結");
  await receiver.goto(await sender.getByTestId("remote-link").inputValue());
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  await expect(receiver.getByTestId("remote-via")).toHaveAttribute("data-via", "direct", { timeout: 20_000 });
  await receiver.getByRole("button", { name: "接收", exact: true }).click();
  await expect(sender.getByTestId("remote-status")).toContainText("已傳", { timeout: 20_000 });
  await sender.evaluate(() => (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.forEach((pc) => pc.close()));
  await expect(receiver.getByTestId("remote-status")).toHaveText("收到 1 個檔案，SHA-256 都對得上，已經放進暫存區。", { timeout: 60_000 });
  await expect(receiver.getByTestId("remote-via")).toHaveAttribute("data-via", "relay");
  await close();
});


test("暫存區沒有檔案也能產生連結，連上之後只互傳文字訊息", async ({ browser, baseURL }) => {
  const { sender, receiver, close } = await people(browser, baseURL!);
  await sender.goto("./");
  await sender.getByRole("button", { name: /^遠端傳送/ }).click();
  await expect(sender.getByRole("button", { name: "送出暫存區的檔案" })).toBeDisabled();
  await sender.getByRole("button", { name: "只傳文字訊息或視訊通話" }).click();
  await expect(sender.getByTestId("remote-privacy")).toBeVisible();
  await sender.getByRole("button", { name: "產生連結", exact: true }).click();
  await receiver.goto(await sender.getByTestId("remote-link").inputValue());
  await expect(receiver.getByTestId("remote-invite")).toContainText("連上之後也能互傳文字訊息、視訊通話");
  await receiver.getByRole("button", { name: "加入", exact: true }).click();
  for (const page of [sender, receiver]) await expect(page.getByTestId("remote-status")).toHaveText("已經連上，可以互傳文字訊息或視訊通話。", { timeout: 20_000 });
  await expect(receiver.getByTestId("remote-confirm").locator("strong")).toHaveText(await sender.getByTestId("remote-confirm").locator("strong").innerText());
  await expect(receiver.getByTestId("remote-incoming")).toHaveCount(0);

  await sender.getByTestId("remote-chat-input").fill("只想跟你說幾句話");
  await sender.getByTestId("remote-chat-input").press("Enter");
  await expect(receiver.getByTestId("remote-messages")).toContainText("只想跟你說幾句話");
  // 連線中只有「結束連線」，結束之後才出現重新開始
  await expect(receiver.getByRole("button", { name: "重新開始" })).toHaveCount(0);
  await receiver.getByRole("button", { name: "結束連線" }).click();
  await receiver.getByTestId("remote-end-ask").getByRole("button", { name: "結束連線" }).click();
  await expect(sender.getByTestId("remote-ended")).toHaveText("對方已經結束連線。");
  await expect(sender.getByTestId("remote-status")).toHaveCount(0);
  await receiver.getByRole("button", { name: "重新開始" }).click();
  await expect(receiver.getByRole("button", { name: "只傳文字訊息或視訊通話" })).toBeVisible();
  await close();
});

test("告知畫面連到遠端傳送的伺服器說明，在新分頁打開，看完回到遠端傳送", async ({ page }) => {
  await page.goto("./remote/");
  await page.getByRole("button", { name: "只傳文字訊息或視訊通話" }).click();
  const link = page.getByTestId("remote-server-link");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("href", "/gears/remote-server/");

  await page.goto("./remote-server/");
  await expect(page).toHaveTitle("遠端傳送的伺服器 | Gears 檔案工作台");
  const section = page.getByTestId("remote-server");
  await expect(section.getByRole("heading", { level: 3 })).toHaveText(["經過的伺服器", "伺服器看得到與看不到的內容", "保存的資料", "加密的方式", "使用的限制", "濫用的回報"]);
  await expect(section).toContainText("不保存檔案");
  await expect(section).toContainText("whisper@anoni.net");
  await page.getByRole("button", { name: "回到遠端傳送" }).click();
  await expect(page).toHaveURL(/\/gears\/remote\/$/);
});
