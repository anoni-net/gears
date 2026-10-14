import { expect, test } from "@playwright/test";
import { classify, parseWifi } from "../../src/tools/qr-read/index.ts";
import { wifiPayload } from "../../src/tools/qrcode/index.ts";

test("Wi-Fi 格式拆成欄位，跳脫字元還原", () => {
  const text = wifiPayload({ ssid: 'Cafe;"5G"', password: "a:b,c\\d", security: "WPA", hidden: true });
  expect(parseWifi(text)).toEqual({ kind: "wifi", ssid: 'Cafe;"5G"', password: "a:b,c\\d", security: "WPA", hidden: true });
  expect(parseWifi("WIFI:T:nopass;S:Guest;;")).toEqual({ kind: "wifi", ssid: "Guest", password: "", security: "nopass", hidden: false });
  expect(parseWifi("hello")).toBeNull();
});

test("分辨網址與一般文字", () => {
  expect(classify("https://anoni.net/gears/")).toEqual({ kind: "url", url: "https://anoni.net/gears/" });
  expect(classify("anoni.net")).toEqual({ kind: "text", text: "anoni.net" });
  expect(classify("javascript:alert(1)").kind).toBe("text");
});
