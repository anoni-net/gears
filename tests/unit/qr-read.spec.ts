import { expect, test } from "@playwright/test";
import { classify, formatIcalTime, parseWifi } from "../../src/tools/qr-read/index.ts";
import { eventPayload, geoPayload, mailtoPayload, smsPayload, telPayload, vcardPayload, wifiPayload } from "../../src/tools/qrcode/index.ts";

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

// 產生器做出來的內容，讀取端要拆得回原本的欄位
test("產生器的每一種格式都拆得回欄位", () => {
  const text = (p: unknown) => (p as { text: string }).text;
  expect(classify(text(vcardPayload({ name: "陳小明", phone: "0912-345-678", email: "ming@example.org", org: "anoni.net, 社群", url: "https://anoni.net/" })))).toEqual({
    kind: "contact",
    name: "陳小明",
    org: "anoni.net, 社群",
    title: "",
    phones: ["0912345678"],
    emails: ["ming@example.org"],
    urls: ["https://anoni.net/"],
    address: "",
    note: "",
  });
  expect(classify(text(mailtoPayload({ to: "a@example.org", subject: "1 + 1", body: "第一行\n第二行" })))).toEqual({ kind: "email", to: "a@example.org", subject: "1 + 1", body: "第一行\n第二行" });
  expect(classify(text(telPayload("+886 2 1234 5678")))).toEqual({ kind: "phone", number: "+886212345678" });
  expect(classify(text(smsPayload({ number: "0912345678", message: "時間：19:00" })))).toEqual({ kind: "sms", number: "0912345678", message: "時間：19:00" });
  expect(classify(text(geoPayload("25.0330, 121.5654")))).toEqual({ kind: "geo", lat: "25.0330", lng: "121.5654" });
  expect(classify(text(eventPayload({ title: "工作坊; 第 2 場", start: "2026-10-20T19:00", end: "2026-10-20T21:30", location: "台北, 線上" })))).toEqual({
    kind: "event",
    title: "工作坊; 第 2 場",
    start: "2026-10-20 19:00",
    end: "2026-10-20 21:30",
    location: "台北, 線上",
    description: "",
  });
});

test("其他程式產生的聯絡資料：MECARD、vCard 2.1 的 quoted-printable、折行與群組", () => {
  expect(classify("MECARD:N:陳,小明;TEL:0912345678;TEL:0223456789;EMAIL:ming@example.org;NOTE:a\\;b;;")).toMatchObject({
    kind: "contact",
    name: "陳小明",
    phones: ["0912345678", "0223456789"],
    note: "a;b",
  });
  expect(classify("MECARD:N:Owen,Sean;URL:https://example.org;;")).toMatchObject({ kind: "contact", name: "Sean Owen", urls: ["https://example.org"] });
  const v21 = ["BEGIN:VCARD", "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E9=99=B3;=E5=B0=8F=E6=98=8E;;;", "TEL;CELL:0912345678", "END:VCARD"].join("\r\n");
  expect(classify(v21)).toMatchObject({ kind: "contact", name: "陳小明", phones: ["0912345678"] });
  const apple = ["BEGIN:VCARD", "VERSION:3.0", "FN:Alice", "TITLE:Rese", " archer", "item1.URL:https://example.org/a,b", "ADR;TYPE=WORK:;;1 Main St;Taipei;;100;Taiwan", "END:VCARD"].join("\n");
  expect(classify(apple)).toMatchObject({ kind: "contact", name: "Alice", title: "Researcher", urls: ["https://example.org/a,b"], address: "1 Main St, Taipei, 100, Taiwan" });
});

test("其他寫法的 Email、簡訊與活動", () => {
  expect(classify("MATMSG:TO:a@example.org;SUB:Hi;BODY:Hello;;")).toEqual({ kind: "email", to: "a@example.org", subject: "Hi", body: "Hello" });
  expect(classify("sms:+886912345678?body=hello%20world")).toEqual({ kind: "sms", number: "+886912345678", message: "hello world" });
  expect(classify("sms:0912345678&body=hi")).toEqual({ kind: "sms", number: "0912345678", message: "hi" });
  expect(classify("geo:91,0").kind).toBe("text");
  const cal = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "SUMMARY:Meetup", "DTSTART;TZID=Asia/Taipei:20261020T190000", "DTEND:20261020T130000Z", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  expect(classify(cal)).toMatchObject({ kind: "event", title: "Meetup", start: "2026-10-20 19:00 Asia/Taipei", end: "2026-10-20 13:00 UTC" });
  expect(formatIcalTime("20261020")).toBe("2026-10-20");
});

test("兩步驟驗證的金鑰只拆出服務與帳號", () => {
  expect(classify("otpauth://totp/Example:alice%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Example")).toEqual({ kind: "otp", type: "TOTP", issuer: "Example", account: "alice@example.org" });
  expect(classify("otpauth://hotp/bob?secret=JBSWY3DPEHPK3PXP&counter=1")).toEqual({ kind: "otp", type: "HOTP", issuer: "", account: "bob" });
});

test("付款網址拆出地址、金額與附註", () => {
  expect(classify("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001&label=anoni.net&message=donation+1")).toEqual({
    kind: "payment",
    coin: "bitcoin",
    address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    amount: "0.001",
    label: "anoni.net",
    message: "donation+1",
  });
  expect(classify("monero:4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge?tx_amount=1.5&recipient_name=anoni&tx_description=%E6%8D%90%E6%AC%BE")).toMatchObject({
    kind: "payment",
    coin: "monero",
    amount: "1.5",
    label: "anoni",
    message: "捐款",
  });
  expect(classify("zcash:zs1example?amount=2").kind).toBe("payment");
});
