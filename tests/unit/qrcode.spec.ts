import { expect, test } from "@playwright/test";
import { encodeQr, eventPayload, geoPayload, mailtoPayload, parseCoordinates, qrPng, qrSvg, QrTooLong, smsPayload, telPayload, vcardPayload, wifiPayload } from "../../src/tools/qrcode/index.ts";
import { decodeQrPng } from "../helpers/qr-decode.ts";

// 產生的 QR code 解碼回文字，要跟輸入一模一樣。編碼寫錯的典型後果是掃得出來、
// 內容卻錯，比壞掉更難發現。
const roundTrip = (text: string, ecc: "L" | "M" | "Q" | "H" = "M") => decodeQrPng(qrPng(encodeQr(text, ecc), 4));

test("英文、網址與 onion 位址", () => {
  for (const text of ["hello", "https://anoni.net/gears/", "http://anoninetru5tflukgfaehun7q6khowgmymcff3gtk5oyesqazhmfxtyd.onion/"]) {
    expect(roundTrip(text)).toBe(text);
  }
});

test("中文與表情符號用 UTF-8，不會變成亂碼", () => {
  for (const text of ["匿名網路社群", "隱私工作台：清除照片的拍攝位置 📷", "简体中文也一样"]) {
    expect(roundTrip(text)).toBe(text);
  }
});

test("四種容錯度都解得回來", () => {
  for (const ecc of ["L", "M", "Q", "H"] as const) expect(roundTrip("anoni.net", ecc)).toBe("anoni.net");
});

test("Wi-Fi 格式跳脫特殊字元", () => {
  const payload = wifiPayload({ ssid: 'Cafe;"5G"', password: "a:b,c\\d", security: "WPA", hidden: true });
  expect(payload).toBe(String.raw`WIFI:T:WPA;S:Cafe\;\"5G\";P:a\:b\,c\\d;H:true;;`);
  expect(roundTrip(payload)).toBe(payload);
  expect(wifiPayload({ ssid: "Guest", password: "ignored", security: "nopass", hidden: false })).toBe("WIFI:T:nopass;S:Guest;;");
});

test("內容太長時丟出 QrTooLong", () => {
  expect(() => encodeQr("x".repeat(4000), "H")).toThrow(QrTooLong);
});

test("SVG 是獨立的向量圖檔", () => {
  const svg = qrSvg(encodeQr("anoni.net", "M"));
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('shape-rendering="crispEdges"');
});

test("聯絡資料用 vCard 3.0，跳脫分號與逗號，解碼回來一字不差", () => {
  const r = vcardPayload({ name: "陳小明", phone: "+886 912-345-678", email: "ming@example.org", org: "anoni.net；社群, 志工", url: "https://anoni.net/?a=1,2" });
  expect(r).toEqual({
    text: ["BEGIN:VCARD", "VERSION:3.0", "N:陳小明;;;;", "FN:陳小明", "ORG:anoni.net；社群\\, 志工", "TEL:+886912345678", "EMAIL:ming@example.org", "URL:https://anoni.net/?a=1,2", "END:VCARD"].join("\n"),
  });
  expect(roundTrip((r as { text: string }).text)).toBe((r as { text: string }).text);
  expect(vcardPayload({ name: "", phone: "", email: "", org: "", url: "" })).toBeNull();
  expect(vcardPayload({ name: "A", phone: "09ab", email: "", org: "", url: "" })).toEqual({ error: "phone" });
  expect(vcardPayload({ name: "A", phone: "", email: "not-an-email", org: "", url: "" })).toEqual({ error: "email" });
});

test("Email 用 mailto，主旨與內容百分比編碼，加號不會變成空白", () => {
  expect(mailtoPayload({ to: "a@example.org, b@example.org", subject: "加密 + 簽章", body: "第一行\n第二行" })).toEqual({
    text: "mailto:a@example.org,b@example.org?subject=%E5%8A%A0%E5%AF%86%20%2B%20%E7%B0%BD%E7%AB%A0&body=%E7%AC%AC%E4%B8%80%E8%A1%8C%0D%0A%E7%AC%AC%E4%BA%8C%E8%A1%8C",
  });
  expect(mailtoPayload({ to: "a@example.org", subject: "", body: "" })).toEqual({ text: "mailto:a@example.org" });
  expect(mailtoPayload({ to: "", subject: "x", body: "" })).toBeNull();
  expect(mailtoPayload({ to: "a@", subject: "", body: "" })).toEqual({ error: "email" });
});

test("電話與簡訊拿掉空白與連字號，其他字元不接受", () => {
  expect(telPayload("+886 (2) 1234-5678")).toEqual({ text: "tel:+886212345678" });
  expect(telPayload("*123#")).toEqual({ text: "tel:*123#" });
  expect(telPayload("call me")).toEqual({ error: "phone" });
  expect(smsPayload({ number: "0912 345 678", message: "時間：19:00" })).toEqual({ text: "SMSTO:0912345678:時間：19:00" });
  expect(smsPayload({ number: "0912345678", message: "" })).toEqual({ text: "SMSTO:0912345678" });
  expect(roundTrip("SMSTO:0912345678:時間：19:00")).toBe("SMSTO:0912345678:時間：19:00");
});

test("座標從地圖 App 複製的格式與地圖網址都讀得出來", () => {
  expect(geoPayload("25.0330, 121.5654")).toEqual({ text: "geo:25.0330,121.5654" });
  expect(geoPayload("25.0330，121.5654")).toEqual({ text: "geo:25.0330,121.5654" });
  expect(geoPayload("https://www.google.com/maps/place/x/@25.0339639,121.5644722,17z/data=!3m1")).toEqual({ text: "geo:25.0339639,121.5644722" });
  expect(geoPayload("geo:-33.8568,151.2153")).toEqual({ text: "geo:-33.8568,151.2153" });
  expect(geoPayload("91, 0")).toEqual({ error: "coords" });
  expect(geoPayload("台北車站")).toEqual({ error: "coords" });
  expect(parseCoordinates("")).toBeNull();
});

test("活動用 VEVENT，時間不帶時區，結束早於開始時說明", () => {
  const r = eventPayload({ title: "Tor 節點工作坊; 第 2 場", start: "2026-10-20T19:00", end: "2026-10-20T21:30", location: "台北, 線上" });
  expect(r).toEqual({
    text: ["BEGIN:VEVENT", String.raw`SUMMARY:Tor 節點工作坊\; 第 2 場`, "DTSTART:20261020T190000", "DTEND:20261020T213000", "LOCATION:台北\\, 線上", "END:VEVENT"].join("\n"),
  });
  expect(roundTrip((r as { text: string }).text)).toBe((r as { text: string }).text);
  expect(eventPayload({ title: "x", start: "2026-10-20T19:00", end: "", location: "" })).toEqual({ text: "BEGIN:VEVENT\nSUMMARY:x\nDTSTART:20261020T190000\nEND:VEVENT" });
  expect(eventPayload({ title: "x", start: "", end: "", location: "" })).toBeNull();
  expect(eventPayload({ title: "x", start: "2026-10-20T19:00", end: "2026-10-20T18:00", location: "" })).toEqual({ error: "eventOrder" });
});
