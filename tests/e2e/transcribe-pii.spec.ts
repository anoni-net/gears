import type { Page } from "@playwright/test";
import { assetsUrl } from "../../src/core/models.ts";
import { PII_MODEL } from "../../src/tools/redact/pii-model.ts";
import { wav } from "../helpers/audio.ts";
import { type Guard, downloadFrom, expect, test } from "./guard.ts";

// 逐字稿的「找人名、地址與單位」（#143，src/ui/StyleModel.tsx 的 transcript）。CI 上沒有會產生段落的錄音，
// 辨識的 Worker 換成固定回覆段落的假 Worker（同 transcribe-punct.spec.ts）。個資辨識的 Worker 也可以換成
// 假的，回固定的範圍，測清單與換上代稱。模型下載失敗那一項用真的 Worker，攔下模型的請求回內容不對的檔案

const DIR = assetsUrl(PII_MODEL.dir, "");

const SEGMENTS = [
  { start: 0, end: 3, text: "我昨天跟林志明見面" },
  { start: 3, end: 5, text: "他在大樂科技公司上班" },
  { start: 5, end: 6, text: "林志明說下週再聊" },
];

async function fakeWorkers(page: Page, fakePii: boolean) {
  await page.addInitScript(
    ({ segments, fakePii }) => {
      const Real = globalThis.Worker;
      class FakeWorker {
        onmessage: ((e: { data: unknown }) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        sent = false;
        constructor(readonly kind: string) {}
        postMessage(data: { type?: string; texts?: string[] }) {
          setTimeout(() => this.reply(data), 20);
        }
        send(data: unknown) {
          this.onmessage?.({ data });
        }
        reply(data: { type?: string; texts?: string[] }) {
          if (this.kind === "transcribe") {
            if (data.type === "start") {
              this.sent = false;
              return this.send({ type: "ready" });
            }
            if (!this.sent) {
              this.sent = true;
              this.send({ type: "segments", segments, pieces: segments.length });
            }
            return this.send({ type: "done" });
          }
          // 個資辨識：每段文字裡的人名與單位
          this.send({ type: "loaded" });
          const find = (text: string, term: string, kind: string) => {
            const out: { kind: string; start: number; end: number }[] = [];
            for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + term.length)) out.push({ kind, start: i, end: i + term.length });
            return out;
          };
          this.send({ type: "result", spans: (data.texts ?? []).map((text) => [...find(text, "林志明", "person"), ...find(text, "大樂科技公司", "org")]) });
        }
        terminate() {}
        addEventListener() {}
        removeEventListener() {}
      }
      globalThis.Worker = function (url: string | URL, options?: WorkerOptions) {
        const u = String(url);
        if (u.includes("transcribe.worker") || u.includes("sherpa.worker")) return new FakeWorker("transcribe");
        if (fakePii && u.includes("/pii.worker")) return new FakeWorker("pii");
        return new Real(url, options);
      } as unknown as typeof Worker;
    },
    { segments: SEGMENTS, fakePii },
  );
}

async function transcribe(page: Page) {
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name: "talk.wav", mimeType: "application/octet-stream", buffer: Buffer.from(wav(2)) });
  await page.getByLabel("華語", { exact: true }).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText(/^完成，共 \d+ 段/);
}

async function start(page: Page) {
  await page.getByTestId("transcribe-model").getByRole("button", { name: "找人名、地址與單位" }).click();
  const ask = page.getByTestId("transcribe-model-ask");
  if (await ask.isVisible()) await ask.getByRole("button", { name: "仍要使用" }).click();
}

const txt = async (page: Page) => new TextDecoder().decode((await downloadFrom(page, () => page.getByRole("button", { name: "下載 TXT" }).click())).data);

const forgetRouted = (guard: Guard) => {
  guard.requests = guard.requests.filter((url) => !url.startsWith(DIR));
};

test("逐字稿：模型找到的人名與單位逐項換成代稱，每一段都換，下載的 TXT 跟著換，可以復原", async ({ page }, testInfo) => {
  await fakeWorkers(page, true);
  await transcribe(page);
  const section = page.getByTestId("transcribe-model");
  if (testInfo.project.name === "iphone") await expect(page.getByTestId("transcribe-model-note")).toHaveCount(0);
  else await expect(page.getByTestId("transcribe-model-note")).toContainText("還沒下載的逐字稿會跟著消失");
  await start(page);
  await expect(page.getByTestId("transcribe-model-status")).toContainText("開源本機模型找到 2 個");
  const terms = page.getByTestId("transcribe-model-terms");
  await expect(terms.locator("li")).toHaveCount(2);
  await terms.getByRole("button", { name: "把「林志明」換成〔人名 A〕（2 處）" }).click();
  await expect(page.getByTestId("transcript")).not.toContainText("林志明");
  await expect(terms.locator("li")).toHaveCount(1);
  await terms.getByRole("button", { name: "把「大樂科技公司」換成〔單位 A〕" }).click();
  await expect(terms.locator("li")).toHaveCount(0);
  const out = await txt(page);
  expect(out).toContain("〔人名 A〕");
  expect(out).toContain("〔單位 A〕");
  expect(out).not.toContain("林志明");
  await page.getByRole("button", { name: "復原" }).click();
  await expect(page.getByTestId("transcript")).toContainText("大樂科技公司");
  // 復原之後那一項又列回來
  await expect(terms.locator("li")).toHaveCount(1);
  await expect(section).toBeVisible();
});

test("逐字稿：模型的內容對不上時說明，逐字稿不受影響", async ({ page, guard }) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  await fakeWorkers(page, false);
  await transcribe(page);
  await start(page);
  await expect(page.getByTestId("transcribe-model-status")).toContainText("沒有辦法執行開源本機模型", { timeout: 90_000 });
  expect(asked.length).toBeGreaterThan(0);
  await expect(page.getByTestId("transcript")).toContainText("林志明");
  forgetRouted(guard);
});
