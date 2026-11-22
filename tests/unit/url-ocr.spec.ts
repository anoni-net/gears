import { expect, test } from "@playwright/test";
import type { LineText } from "../../src/tools/redact/pii.ts";
import { type OcrLine, ocrLineText } from "../../src/tools/redact/ppocr.ts";
import { looksLikeUrl, urlsFromLines } from "../../src/tools/url-check/ocr.ts";

// 從截圖讀出網址的整理（src/tools/url-check/ocr.ts）。辨識結果用假的字框組出來：每個字寬 10、高 20，
// 一行的左上角在 (x, y)，空白沒有框
function line(text: string, x = 0, y = 0, h = 20): LineText {
  const boxes = [];
  let cx = x;
  for (const ch of text) {
    for (let i = 0; i < ch.length; i++) boxes.push(ch === " " ? null : { x: cx, y, w: 10, h });
    cx += 10;
  }
  return { text, boxes };
}
// 同一段文字的下一行：行距 1.4 倍字高
const lines = (...texts: string[]) => texts.map((t, i) => line(t, 0, i * 28));
const texts = (ls: LineText[]) => urlsFromLines(ls).map((u) => u.text);

test("一般的網址與 www、結尾的標點不算進網址", () => {
  expect(texts([line("請看 https://example.com/a?b=1。")])).toEqual(["https://example.com/a?b=1"]);
  expect(texts([line("連到 www.example.org！")])).toEqual(["www.example.org"]);
  expect(texts([line("(see https://en.example.org/wiki/Foo_(bar)).")])).toEqual(["https://en.example.org/wiki/Foo_(bar)"]);
  expect(texts([line("\"https://example.com/x\",")])).toEqual(["https://example.com/x"]);
});

test("全形的英數與符號換成半形", () => {
  expect(texts([line("ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ／ｌｏｇｉｎ")])).toEqual(["https://example.com/login"]);
  expect(texts([line("網址https：//shop.example/item？id＝3")])).toEqual(["https://shop.example/item?id=3"]);
});

test("夾在英數之間的句號換成點，收尾的句號不算", () => {
  expect(texts([line("請到example。com登入")])).toEqual(["example.com"]);
  expect(texts([line("https://pay.example。test/a")])).toEqual(["https://pay.example.test/a"]);
  expect(texts([line("網址是 example.com。謝謝")])).toEqual(["example.com"]);
});

test("中文標點緊接網址", () => {
  expect(texts([line("點這裡：https://a.example/x，然後登入")])).toEqual(["https://a.example/x"]);
  expect(texts([line("「bit.ly/3abcDEF」")])).toEqual(["bit.ly/3abcDEF"]);
  expect(texts([line("（line.me/ti/p/abc123）")])).toEqual(["line.me/ti/p/abc123"]);
});

test("沒有 https:// 的網域、短網址", () => {
  expect(texts([line("加我 line.me/ti/p/~friend")])).toEqual(["line.me/ti/p/~friend"]);
  expect(texts([line("bit.ly/3xYz9Ab")])).toEqual(["bit.ly/3xYz9Ab"]);
  expect(texts([line("官網 example.com.tw 有說明")])).toEqual(["example.com.tw"]);
  expect(texts([line("lin.ee/AbC")])).toEqual(["lin.ee/AbC"]);
});

test("Email、版本號、小數不是網址", () => {
  expect(texts([line("寄到 jane@example.org 就好")])).toEqual([]);
  expect(texts([line("更新到 v1.2.3 版，價格 3.50 元")])).toEqual([]);
  expect(looksLikeUrl("jane@example.org")).toBe(false);
  expect(looksLikeUrl("1.2.3")).toBe(false);
  expect(looksLikeUrl("e.g")).toBe(false);
});

test("檔名不是網址，頂層網域照樣列出（.zip、.mov 是真的頂層網域，常被拿來做釣魚）", () => {
  expect(texts([line("photo.jpg 傳給你了")])).toEqual([]);
  expect(texts([line("檔案是 report.pdf 我晚點傳")])).toEqual([]);
  expect(texts([line("Node.js 跟 Vue.js 我都會")])).toEqual([]);
  expect(texts([line("data.JSON、notes.txt、slides.pptx")])).toEqual([]);
  expect(texts([line("下載 example.zip 就好")])).toEqual(["example.zip"]);
  expect(texts([line("影片在 clip.mov")])).toEqual(["clip.mov"]);
  expect(texts([line("readme.md")])).toEqual(["readme.md"]);
  // 有協定、www. 或路徑時是網址
  expect(texts([line("https://cdn.example/photo.jpg")])).toEqual(["https://cdn.example/photo.jpg"]);
  expect(texts([line("https://files.pdf")])).toEqual(["https://files.pdf"]);
  expect(texts([line("www.example.pdf")])).toEqual(["www.example.pdf"]);
  expect(texts([line("report.pdf/download")])).toEqual(["report.pdf/download"]);
});

test("不自動修正看起來像的字：paypa1、rnicrosoft、g00gle 照辨識的結果", () => {
  expect(texts([line("https://paypa1.example/login")])).toEqual(["https://paypa1.example/login"]);
  expect(texts([line("rnicrosoft-support.test")])).toEqual(["rnicrosoft-support.test"]);
  expect(texts([line("https://g00gle.example")])).toEqual(["https://g00gle.example"]);
  expect(texts([line("https://SHOP.Example.COM/ABC")])).toEqual(["https://SHOP.Example.COM/ABC"]);
});

test("被換行切開的網址接回來，框合併兩行", () => {
  const ok = lines("https://verify.example.test/", "account/login?id=", "8812");
  const [u] = urlsFromLines(ok);
  expect(u!.text).toBe("https://verify.example.test/account/login?id=8812");
  expect(u!.lines).toBe(3);
  expect(u!.box).toEqual({ x: 0, y: 0, w: 280, h: 76 });
  expect(texts(lines("https://a.example/path", "/more"))).toEqual(["https://a.example/path/more"]);
  // 英數接英數：上一段還不是完整的網址（break-all 從字中間切開）
  expect(texts(lines("https://s", "hop.example.org/item?id=88", "123"))).toEqual(["https://shop.example.org/item?id=88123"]);
  // 協定的前半、網域裡的連字號
  expect(texts(lines("ht", "tps://a.example/x"))).toEqual(["https://a.example/x"]);
  expect(texts(lines("1ine-", "pay.test/login"))).toEqual(["1ine-pay.test/login"]);
  expect(texts(lines("netflix-b", "illing.example"))).toEqual(["netflix-billing.example"]);
  expect(texts(lines("g00gle", "-verify.example"))).toEqual(["g00gle-verify.example"]);
});

test("中文後面緊接的英數在行尾被切開", () => {
  expect(texts(lines("請於24小時內至paypa", "l-secure.example更新"))).toEqual(["paypal-secure.example"]);
  expect(texts(lines("完成驗證：ex", "ample。com。tw"))).toEqual(["example.com.tw"]);
  // 英文句子行尾的單字前面有空白，不接
  expect(texts(lines("Your account is locked. Ver", "ify at a.example"))).toEqual(["a.example"]);
});

test("最後一段只剩英文字母時：寫滿的行才接，句子的下一個字不接", () => {
  // 網址寫滿了這一行（同一側對齊的行裡最寬），下一行只有一個單字：被切開的網址
  expect(texts(lines("https://docs.example.com/getting-sta", "rted"))).toEqual(["https://docs.example.com/getting-started"]);
  // 同一側有更寬的行，網址那一行沒有寫滿：下一行的 OK 是另一句
  const ls = [line("這是一段比網址那一行還要長很多的文字，對話框寫滿了", 0, 0), line("https://a.example", 0, 100), line("OK", 0, 128)];
  expect(texts(ls)).toEqual(["https://a.example"]);
  // 首字大寫或全部大寫的單字是另一句話，網址那一行寫滿了也不接
  expect(texts(lines("https://a.example/x", "OK"))).toEqual(["https://a.example/x"]);
  expect(texts(lines("https://a.example/x", "Thanks"))).toEqual(["https://a.example/x"]);
  // 單字後面接著標點或別的字：句子的下一個字
  expect(texts(lines("Verify at https://a.example/x", "now."))).toEqual(["https://a.example/x"]);
  expect(texts(lines("https://a.example/x", "login now"))).toEqual(["https://a.example/x"]);
  // 一個字母加句號照樣接（最後一個字母被擠到下一行，後面的「。」被認成點）
  expect(texts(lines("請上https://bit.ly/4QwErT", "y."))).toEqual(["https://bit.ly/4QwErTy"]);
});

test("下一行接著別的內容時只接開頭那一段", () => {
  expect(texts(lines("https://a.example/x?utm_source=", "line 請點開"))).toEqual(["https://a.example/x?utm_source=line"]);
});

test("下一則訊息不會接進網址", () => {
  // 下一行是另一個網址
  expect(texts(lines("https://a.example/", "https://b.example"))).toEqual(["https://a.example/", "https://b.example"]);
  // 下一行離得遠（另一個對話框）
  expect(texts([line("https://a.example/", 0, 0), line("next", 0, 60)])).toEqual(["https://a.example/"]);
  // 下一行在另一欄
  expect(texts([line("https://a.example/", 0, 0), line("abc", 300, 28)])).toEqual(["https://a.example/"]);
  // 對話框旁邊的時間夾在中間：取左邊對齊的那一行
  expect(texts([line("https://a.example/", 0, 0), line("下午9:17", 0, 22, 14), line("path", 0, 28)])).toEqual(["https://a.example/path"]);
});

test("兩欄的對話框：下一行夾著另一欄的行", () => {
  const ls = [line("https://a.example/", 0, 0), line("好的", 300, 2), line("path", 0, 28)];
  expect(texts(ls)).toEqual(["https://a.example/path"]);
});

test("辨識的誤差：點被認成間隔點或度數符號、協定與問號前多出空白", () => {
  expect(texts([line("www·example·com")])).toEqual(["www.example.com"]);
  expect(texts([line("example º com ° tw")])).toEqual(["example.com.tw"]);
  expect(texts([line("https ://example.com/login")])).toEqual(["https://example.com/login"]);
  expect(texts([line("https: //example.com/login")])).toEqual(["https://example.com/login"]);
  expect(texts([line("https://shop.example.org/item ?id=5")])).toEqual(["https://shop.example.org/item?id=5"]);
  // 句子之間的間隔點不換
  expect(texts([line("台北 · 高雄")])).toEqual([]);
  // 句點後面少了空白的句子
  expect(texts([line("Your account is locked.Verify at a.example")])).toEqual(["a.example"]);
});

test("同一個網址出現兩次只列一次", () => {
  expect(texts(lines("https://a.example/x", "再貼一次 https://a.example/x"))).toEqual(["https://a.example/x"]);
});

test("辨識原文排成一行：空白沒有框，不補空白", () => {
  const box = (x: number) => ({ x, y: 0, w: 5, h: 10 });
  const ocr = { text: "看 a.co：", chars: [..."看a.co："].map((c, i) => ({ c, prob: 1, box: box(i * 5) })) } as unknown as OcrLine;
  const r = ocrLineText(ocr);
  expect(r.text).toBe("看 a.co：");
  expect(r.boxes.map((b) => b?.x ?? null)).toEqual([0, null, 5, 10, 15, 20, 25]);
});
