import { expect, test } from "@playwright/test";
import { encodeQr, qrPng, qrSvg, QrTooLong, wifiPayload } from "../../src/tools/qrcode/index.ts";
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
