import { expect, test } from "@playwright/test";
import { classify } from "../../src/tools/qr-read/index.ts";
import { dayOfYear } from "../../src/tools/qr-read/barcode.ts";
import { crc16 } from "../../src/tools/qr-read/pay.ts";
import { bcbp } from "../helpers/barcodes.ts";
import samples from "../../src/tools/qr-read/samples.json" with { type: "json" };

// 讀取端認得的其他格式。位址用保留給文件的 IP（192.0.2.0/24、2001:db8::/32），帳號都是假的
const FP = "0123456789ABCDEF0123456789ABCDEF01234567";

test("Tor bridge：一行一個、清單的寫法，沒有指紋的 IP 不算", () => {
  const obfs4 = `obfs4 192.0.2.10:443 ${FP} cert=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghijklmnopq iat-mode=0`;
  const webtunnel = `webtunnel [2001:db8::1]:443 ${FP} url=https://example.org/secret-path ver=0.0.1`;
  expect(classify(`${obfs4}\n${webtunnel}`)).toEqual({
    kind: "bridge",
    bridges: [
      { transport: "obfs4", address: "192.0.2.10:443" },
      { transport: "webtunnel", address: "[2001:db8::1]:443" },
    ],
    lines: [obfs4, webtunnel],
  });
  expect(classify(`['${obfs4}', '${obfs4.replace("192.0.2.10", "192.0.2.11")}']`)).toMatchObject({ kind: "bridge", bridges: [{ address: "192.0.2.10:443" }, { address: "192.0.2.11:443" }] });
  expect(classify(`Bridge 192.0.2.12:9001 ${FP}`)).toMatchObject({ kind: "bridge", bridges: [{ transport: "vanilla" }], lines: [`192.0.2.12:9001 ${FP}`] });
  expect(classify("192.0.2.1:443").kind).toBe("text");
});

test("passkey 跨裝置登入的 QR code", () => {
  expect(classify("FIDO:/1234567890123456789012345678901234567890")).toEqual({ kind: "passkey" });
  expect(classify("FIDO:/abc").kind).toBe("text");
});

test("VPN 與代理的設定只拆出伺服器與名稱", () => {
  const userinfo = Buffer.from("aes-256-gcm:secret").toString("base64url");
  expect(classify(`ss://${userinfo}@192.0.2.1:8388#%E6%9D%B1%E4%BA%AC`)).toEqual({ kind: "proxy", protocol: "Shadowsocks", server: "192.0.2.1:8388", name: "東京" });
  expect(classify(`ss://${Buffer.from("aes-256-gcm:secret@192.0.2.2:8388").toString("base64")}#old`)).toMatchObject({ server: "192.0.2.2:8388", name: "old" });
  const vmess = Buffer.from(JSON.stringify({ v: "2", ps: "節點 1", add: "example.org", port: "443", id: "00000000-0000-0000-0000-000000000000" })).toString("base64");
  expect(classify(`vmess://${vmess}`)).toEqual({ kind: "proxy", protocol: "VMess", server: "example.org:443", name: "節點 1" });
  expect(classify("vless://00000000-0000-0000-0000-000000000000@example.org:443?security=reality#hk")).toMatchObject({ protocol: "VLESS", server: "example.org:443", name: "hk" });
  expect(classify("trojan://secret@[2001:db8::2]:443#t")).toMatchObject({ protocol: "Trojan", server: "[2001:db8::2]:443" });
  expect(classify("hy2://secret@example.org:8443/?sni=example.org")).toMatchObject({ protocol: "Hysteria 2", server: "example.org:8443" });
  const wg = "[Interface]\nPrivateKey = aGVsbG8=\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = d29ybGQ=\nEndpoint = 192.0.2.3:51820\n";
  expect(classify(wg)).toEqual({ kind: "proxy", protocol: "WireGuard", server: "192.0.2.3:51820", name: "" });
});

test("通訊軟體的邀請連結，電話號碼另外列出", () => {
  expect(classify("https://signal.me/#p/+886912345678")).toMatchObject({ kind: "invite", app: "Signal", target: "contact", phone: "+886912345678" });
  expect(classify("https://signal.me/#eu/abcdefg")).toMatchObject({ app: "Signal", target: "contact", phone: "" });
  expect(classify("https://signal.group/#CjQKIA")).toMatchObject({ app: "Signal", target: "group" });
  expect(classify("https://matrix.to/#/@alice:example.org")).toMatchObject({ app: "Matrix", target: "contact" });
  expect(classify("https://matrix.to/#/#room:example.org")).toMatchObject({ app: "Matrix", target: "group" });
  expect(classify("https://line.me/ti/p/~anoni")).toMatchObject({ app: "LINE", target: "contact" });
  expect(classify("https://line.me/R/ti/g/AbCdEf")).toMatchObject({ app: "LINE", target: "group" });
  expect(classify("https://t.me/+AbCdEfGh")).toMatchObject({ app: "Telegram", target: "group" });
  expect(classify("https://t.me/anoninet")).toMatchObject({ app: "Telegram", target: "either" });
  expect(classify("https://wa.me/886912345678")).toMatchObject({ app: "WhatsApp", target: "contact", phone: "+886912345678" });
  expect(classify("https://chat.whatsapp.com/AbCdEf")).toMatchObject({ app: "WhatsApp", target: "group" });
  expect(classify("https://simplex.chat/contact#/?v=2&smp=x")).toMatchObject({ app: "SimpleX" });
  expect(classify("https://t.me/").kind).toBe("url");
  expect(classify("https://anoni.net/gears/").kind).toBe("url");
});

test("台灣 Pay 的共通 QR code，有的銀行整串百分比編碼", () => {
  const raw = "TWQRP://個人轉帳/158/02/V1?D1=15000&D5=812&D6=0012345678901234&D9=拆帳&D10=901";
  const expected = { kind: "twpay", type: "transfer", service: "個人轉帳", amount: "150", bank: "812", account: "12345678901234", merchant: "", memo: "拆帳", expires: "" };
  expect(classify(raw)).toEqual(expected);
  expect(classify(encodeURIComponent(raw))).toEqual(expected);
  expect(classify("TWQRP://小店/158/01/V1?D1=4950&D8=%E5%B0%8F%E5%BA%97&D12=20261231235959")).toMatchObject({ type: "pay", amount: "49.5", merchant: "小店", expires: "2026-12-31 23:59" });
});

// 組一張 EMVCo 的付款碼：「標籤、兩碼長度、內容」接起來，最後補上 CRC
const f = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, "0")}${value}`;
const emv = (...fields: string[]) => {
  const head = `${f("00", "01")}${fields.join("")}6304`;
  return head + crc16(head);
};

test("EMVCo 商家付款碼：付款網路、商家、金額，檢查碼對不上時標出", () => {
  expect(crc16("123456789")).toBe("29B1");
  const promptpay = emv(f("01", "12"), f("29", f("00", "A000000677010111") + f("01", "0066812345678")), f("53", "764"), f("54", "55.00"), f("58", "TH"), f("59", "Anoni Cafe"), f("60", "Bangkok"));
  expect(classify(promptpay)).toEqual({ kind: "merchant-pay", scheme: "PromptPay", merchant: "Anoni Cafe", city: "Bangkok", country: "TH", amount: "55.00", currency: "THB", crcOk: true });
  expect(classify(promptpay.replace("Anoni Cafe", "Evil  Cafe"))).toMatchObject({ kind: "merchant-pay", crcOk: false });
  expect(classify(emv(f("26", f("00", "SG.PAYNOW") + f("01", "2")), f("53", "702"), f("58", "SG"), f("59", "Test"), f("60", "Singapore")))).toMatchObject({ scheme: "PayNow", currency: "SGD", country: "SG" });
});

test("登機證：姓名、訂位代號、航班、日期與座位", () => {
  const text = bcbp({ name: "WANG/XIAOMING MR", pnr: "ABC123", from: "TPE", to: "NRT", carrier: "CI", flight: "100", day: 293, seat: "12A" });
  expect(text).toHaveLength(60);
  expect(classify(text, "PDF417")).toEqual({
    kind: "boarding-pass",
    name: "WANG/XIAOMING MR",
    legs: [{ pnr: "ABC123", from: "TPE", to: "NRT", carrier: "CI", flight: "100", day: 293, compartment: "Y", seat: "12A" }],
    extra: false,
  });
  expect(classify(bcbp({ name: "LEE/A", pnr: "XYZ999", from: "KHH", to: "HKG", carrier: "BR", flight: "865", day: 5, seat: "3C", extra: ">5180" }), "Aztec")).toMatchObject({ extra: true });
  expect(dayOfYear(293, 2026)).toEqual({ month: 10, date: 20 });
  expect(dayOfYear(60, 2028)).toEqual({ month: 2, date: 29 });
});

test("商品條碼要看條碼種類，同樣的數字放在 QR code 裡只是文字", () => {
  expect(classify("4710088412348", "EAN13")).toEqual({ kind: "product", code: "4710088412348", type: "EAN-13", region: "TW" });
  expect(classify("9789863479505", "EAN13")).toMatchObject({ type: "ISBN", region: "" });
  expect(classify("0036000291452", "EAN13")).toMatchObject({ type: "UPC", region: "US" });
  expect(classify("036000291452", "UPCA")).toMatchObject({ code: "0036000291452", type: "UPC", region: "US" });
  expect(classify("2001234567893", "EAN13")).toMatchObject({ region: "store" });
  expect(classify("96385074", "EAN8")).toMatchObject({ type: "EAN-8" });
  expect(classify("4710088412348").kind).toBe("text");
});

test("電子發票的一維條碼：期別、發票號碼與隨機碼", () => {
  expect(classify("11410AB123456789999", "Code39")).toEqual({ kind: "invoice-barcode", year: 2025, months: [9, 10], number: "AB-12345678", random: "9999" });
  expect(classify("11409AB123456789999", "Code39").kind).toBe("text");
  expect(classify("11410AB123456789999", "Code128").kind).toBe("text");
});

// 讀取工具的範例（scripts/make-qr-samples.mjs 照這份產生圖片）：每一張都要拆成標示的格式
test("範例的內容都認得出標示的格式", () => {
  for (const sample of samples) {
    const text = "bytes" in sample ? new TextDecoder("big5").decode(Buffer.from(sample.bytes, "hex")) : sample.text;
    expect(classify(text, sample.format).kind, sample.id).toBe(sample.kind);
  }
});
