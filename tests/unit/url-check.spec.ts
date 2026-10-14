import { expect, test } from "@playwright/test";
import { cleanUrl, isShortener, parseUrl } from "../../src/tools/url-check/clean.ts";
import { hostFacts, punycodeDecode, registrableDomain } from "../../src/tools/url-check/host.ts";
import { findScam, parseScamList } from "../../src/tools/url-check/scam-list.ts";

const url = (s: string) => {
  const u = parseUrl(s);
  if (typeof u === "string") throw new Error(u);
  return u;
};
const clean = (s: string) => cleanUrl(url(s));
const kinds = (s: string) => hostFacts(url(s)).warnings.map((w) => w.kind);

test("解析網址：補上 https，拒絕其他協定與不像網址的字", () => {
  expect(url("anoni.net/gears/").href).toBe("https://anoni.net/gears/");
  expect(parseUrl("")).toBe("empty");
  expect(parseUrl("javascript:alert(1)")).toBe("scheme");
  expect(parseUrl("hello")).toBe("invalid");
});

test("只拿掉認得出來的追蹤參數，功能參數保留", () => {
  const r = clean("https://www.youtube.com/watch?v=abc&si=XYZ&utm_source=line&t=30#top");
  expect(r.clean).toBe("https://www.youtube.com/watch?v=abc&t=30#top");
  expect(r.removed.map((x) => x.name)).toEqual(["si", "utm_source"]);
  expect(clean("https://example.com/?fbclid=1").clean).toBe("https://example.com/");
  expect(clean("https://example.com/?q=tor&gclid=1").clean).toBe("https://example.com/?q=tor");
});

test("網站專屬的參數只在那個網站上拿掉", () => {
  expect(clean("https://www.tiktok.com/@a/video/1?_t=8x&_r=1&lang=zh").clean).toBe("https://www.tiktok.com/@a/video/1?lang=zh");
  expect(clean("https://example.com/?_t=8x&_r=1").clean).toBe("https://example.com/?_t=8x&_r=1");
  expect(clean("https://shopee.tw/product/1/2?sp_atk=abc&xptdk=def").clean).toBe("https://shopee.tw/product/1/2");
});

test("拆掉轉址包裝，最多五層", () => {
  const inner = encodeURIComponent("https://anoni.net/?utm_medium=social");
  const r = clean(`https://l.facebook.com/l.php?u=${inner}&h=AT0`);
  expect(r.clean).toBe("https://anoni.net/");
  expect(r.unwrapped).toEqual(["l.facebook.com"]);
  expect(clean(`https://www.google.com/url?q=${encodeURIComponent("https://example.org/a")}&sa=D`).clean).toBe("https://example.org/a");
});

test("短網址只提醒，不連線", () => {
  expect(isShortener("reurl.cc")).toBe(true);
  expect(isShortener("shp.ee")).toBe(true);
  expect(isShortener("anoni.net")).toBe(false);
});

test("註冊網域與冒充的寫法", () => {
  expect(registrableDomain("www.gov.taipei")).toBe("gov.taipei");
  expect(registrableDomain("a.b.example.com.tw")).toBe("example.com.tw");
  expect(registrableDomain("foo.netlify.app")).toBe("foo.netlify.app");
  expect(kinds("https://shopee.tw.login-verify.top/")).toContain("brandSubdomain");
  expect(kinds("https://shopee-tw-service.com/")).toContain("brandLookalike");
  expect(kinds("https://shopee.tw/")).toEqual([]);
  expect(kinds("https://google.com@evil.top/")).toContain("userinfo");
  expect(kinds("http://1.2.3.4:8080/")).toEqual(expect.arrayContaining(["http", "ip", "port"]));
});

test("IDN：解開 Punycode，標出長得像英文的網域", () => {
  expect(punycodeDecode("mnchen-3ya")).toBe("münchen");
  expect(punycodeDecode("80ak6aa92e")).toBe("аррӏе");
  const facts = hostFacts(url("https://xn--80ak6aa92e.com/"));
  expect(facts.display).toBe("аррӏе.com");
  expect(facts.warnings.map((w) => w.kind)).toEqual(expect.arrayContaining(["wholeScript", "idn"]));
  expect(kinds("https://xn--pple-43d.com/")).toContain("mixedScript"); // аpple.com
});

test("165 清單：比對主機名與它的上層網域", () => {
  const list = parseScamList("# from=2025-12 to=2026-09 count=3\nscam-shop.cc\nfoo.netlify.app\nbad.example.top\n");
  expect(list.from).toBe("2025-12");
  expect(list.to).toBe("2026-09");
  expect(findScam("scam-shop.cc", list)).toBe("scam-shop.cc");
  expect(findScam("www.scam-shop.cc", list)).toBe("scam-shop.cc");
  expect(findScam("foo.netlify.app", list)).toBe("foo.netlify.app");
  expect(findScam("bar.netlify.app", list)).toBeNull();
  expect(findScam("example.top", list)).toBeNull();
  expect(findScam("anoni.net", list)).toBeNull();
});
