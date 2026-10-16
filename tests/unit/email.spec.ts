import { expect, test } from "@playwright/test";
import { assess } from "../../src/tools/email/assess.ts";
import { decodeWords, looksLikeEmail, parseAddress, parseEmail } from "../../src/tools/email/parse.ts";
import { LEGIT_EML, PDF_BYTES, PHISH_EML } from "../helpers/emails.ts";

const enc = new TextEncoder();

test("標頭的編碼字、地址與 mbox 的開頭", () => {
  expect(decodeWords("=?UTF-8?B?5Y+w5YyX?= =?UTF-8?Q?_=E5=B8=82?=")).toBe("台北 市");
  expect(decodeWords("=?big5?B?pXjGVw==?=")).toBe("台灣");
  expect(parseAddress('"Doe, Jane" <Jane@Example.ORG>')).toEqual({ name: "Doe, Jane", address: "Jane@Example.ORG", domain: "example.org" });
  expect(parseAddress("plain@example.org")).toEqual({ name: undefined, address: "plain@example.org", domain: "example.org" });
  expect(looksLikeEmail(enc.encode(LEGIT_EML))).toBe(true);
  expect(looksLikeEmail(enc.encode(`From sender@example.org Thu Oct 16 2026\n${PHISH_EML}`))).toBe(true);
  expect(looksLikeEmail(enc.encode("Hello: world\n\nnot an email"))).toBe(false);
});

test("正常的電子報：寄件驗證通過，讀出主旨、時間、路徑、連結與附件", () => {
  const msg = parseEmail(LEGIT_EML);
  expect(msg.from).toEqual({ name: "社群電子報", address: "hello@news.example.org", domain: "news.example.org" });
  expect(msg.subject).toBe("十月活動通知");
  expect(msg.date).toMatchObject({ text: "2026-10-16 17:05:00", offset: "+08:00" });
  expect(msg.received).toHaveLength(2);
  expect(msg.received[1]).toMatchObject({ from: "mail.news.example.org", by: "mx.example.net", ip: "192.0.2.10" });
  expect(msg.received[1]!.time).toMatchObject({ text: "2026-10-16 02:05:09", offset: "-07:00" });
  expect(msg.dkimDomains).toEqual(["news.example.org"]);
  expect(msg.mailer).toBe("Newsletter 2.1");
  expect(msg.links).toEqual(["https://news.example.org/events/10?utm_source=mail"]);
  expect(msg.attachments).toHaveLength(1);
  expect(msg.attachments[0]!.name).toBe("報告.pdf");
  expect(new TextDecoder().decode(msg.attachments[0]!.data)).toBe(PDF_BYTES);

  const a = assess(msg);
  expect(a.verdict).toBe("pass");
  expect(a.domain).toBe("news.example.org");
  expect(a.authserv).toBe("mx.example.net");
  expect(a.checks.map((c) => [c.method, c.result, c.aligned])).toEqual([
    ["dkim", "pass", true],
    ["spf", "pass", true],
    ["dmarc", "pass", true],
  ]);
  // 退信地址是同一個網域的子網域，不提醒
  expect(a.notes).toEqual([]);
});

test("冒用的信：只信最上面的驗證結果，提醒回覆地址、顯示名稱與危險的附件", () => {
  const msg = parseEmail(PHISH_EML);
  const a = assess(msg);
  expect(a.verdict).toBe("fail");
  expect(a.authserv).toBe("mx.example.net");
  expect(a.notes.map((n) => n.code)).toEqual(["reply-to", "display-name", "date-skew", "dangerous-attachment"]);
  expect(a.notes[0]).toMatchObject({ value: "collect@another.example", other: "alert@secure-login.example.com" });
  expect(a.notes[1]).toMatchObject({ value: "service@bank.example" });
  expect(a.notes[3]).toMatchObject({ value: "invoice.html" });
  expect(msg.links).toEqual(["https://secure-login.example.com/verify?id=1&x=2"]);
  expect(msg.received[0]!.ip).toBe("198.51.100.7");
});

test("只貼標頭、沒有驗證紀錄、沒有標頭的情況", () => {
  const head = LEGIT_EML.split("\r\n\r\n")[0]!;
  expect(assess(parseEmail(head)).notes.map((n) => n.code)).toEqual(["headers-only"]);
  const noAuth = assess(parseEmail("From: a@example.org\r\nDate: Thu, 16 Oct 2026 10:00:00 +0800\r\n\r\nhi"));
  expect(noAuth.verdict).toBe("unrecorded");
  expect(assess(parseEmail("only some body text")).notes.map((n) => n.code)).toEqual(["body-only"]);
});
