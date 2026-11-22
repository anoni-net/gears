import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

// AGENTS.md「設計語言」裡能從原始碼檢查的規則：元件用到的 class 都有樣式、字串鍵不借用其他工具的
const root = new URL("../../src/", import.meta.url).pathname;
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "i18n" ? [] : sources(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const files = sources(root);
const css = readFileSync(join(root, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]!));

// 沒有樣式、留著給瀏覽器測試找元素用的 class。新增掛鉤時優先用 data-testid
const HOOKS = new Set(["intro", "create", "not-found", "url-check"]);

test("元件裡寫死的 class 都有對應的樣式規則", () => {
  const missing: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".tsx")))
    for (const m of readFileSync(file, "utf8").matchAll(/ class="([^"]+)"/g))
      for (const name of m[1]!.split(/\s+/)) if (name && !cssClasses.has(name) && !HOOKS.has(name)) missing.push(`${basename(file)}: ${name}`);
  expect(missing).toEqual([]);
});

// 工具專屬的字串鍵前綴與可以用它的檔案。各工具共用的詞放在 common.*，兩種傳送共用的放在 transfer.*，
// 化名表單放在 alias.*，QR code 產生與讀取共用的欄位放在 qrfield.*
const OWNERS: Record<string, string[]> = {
  redact: ["RedactEditor.tsx"],
  blend: ["BlendEditor.tsx"],
  printDots: ["PrintDotsEditor.tsx"],
  pdfPages: ["PdfPagesEditor.tsx"],
  frames: ["VideoFramesEditor.tsx"],
  heic: ["HeicConvert.tsx"],
  docCheck: ["DocCheckEditor.tsx"],
  // 查證也讀 .eml，匯出的紀錄寫出同樣的寄件驗證結果
  email: ["EmailTool.tsx", "verify-report.ts"],
  // 查證的畫面、匯出的紀錄與服務提供者編碼的說明
  verify: ["VerifyTool.tsx", "verify-report.ts", "provider-text.ts", "SimilarImages.tsx"],
  // 已下載的模型列出逐字稿的模型名稱
  transcribe: ["TranscribeEditor.tsx", "StoragePage.tsx"],
  textcrypt: ["TextCryptTool.tsx"],
  keygen: ["KeygenTool.tsx"],
  pw: ["PassphraseTool.tsx"],
  qr: ["QrTool.tsx"],
  // QR code 讀取的畫面也用在檔案畫面（圖片裡的 QR code）與範例頁
  qrread: ["QrReadTool.tsx", "QrContentView.tsx", "FileView.tsx", "SamplesPage.tsx"],
  // 信件檢查沿用網址檢查的相似品牌判斷，提醒的寫法相同
  url: ["UrlCheckTool.tsx", "EmailTool.tsx"],
  // 從截圖讀出網址：網址檢查的入口與檔案畫面的「畫面上的網址」共用同一份列表
  urlocr: ["UrlFromScreenshot.tsx", "OcrUrlList.tsx", "ScreenCheck.tsx"],
  style: ["WritingStyleTool.tsx"],
  software: ["SoftwareVerifyTool.tsx"],
  nearby: ["NearbyTool.tsx"],
  remote: ["RemoteTool.tsx"],
  // age 是加密的格式，加密、解密、加密文字與金鑰產生器共用
  age: ["AgeEditors.tsx", "AgeKeyFields.tsx", "KeygenTool.tsx", "TextCryptTool.tsx"],
};

test("工具專屬的字串鍵只在那個工具的元件裡用", () => {
  const borrowed: string[] = [];
  for (const file of files) {
    const name = basename(file);
    for (const m of readFileSync(file, "utf8").matchAll(/\bt(?:Dynamic)?\(\s*["`]([a-zA-Z]+)\./g)) {
      const owners = OWNERS[m[1]!];
      if (owners && !owners.includes(name)) borrowed.push(`${name}: ${m[1]}.*`);
    }
  }
  expect([...new Set(borrowed)]).toEqual([]);
});
