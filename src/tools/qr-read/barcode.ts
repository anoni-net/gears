// 條碼裡常見的內容：登機證（IATA BCBP）、商品條碼（EAN、UPC、ISBN）、電子發票證明聯的一維條碼。
// 影像由 zxing-wasm 解碼（src/ui/qr-scan.ts），這裡只解讀文字。

export interface FlightLeg {
  pnr: string;
  from: string;
  to: string;
  carrier: string;
  flight: string;
  day: number; // 一年中的第幾天，條碼沒有記年份
  compartment: string;
  seat: string;
}

export type BoardingPassContent = { kind: "boarding-pass"; name: string; legs: FlightLeg[]; extra: boolean };
export type ProductContent = { kind: "product"; code: string; type: "EAN-13" | "EAN-8" | "UPC" | "ISBN" | "ISSN"; region: string };
export type InvoiceBarcodeContent = { kind: "invoice-barcode"; year: number; months: [number, number]; number: string; random: string };

// 登機證的條碼（IATA Resolution 792 的 BCBP，多半印成 PDF417 或 Aztec，也有 QR code）：
// M、航段數、姓名 20 碼、電子機票註記，接著每個航段固定 35 碼（訂位代號 7、出發地 3、
// 目的地 3、航空公司 3、航班 5、一年中的第幾天 3、艙等 1、座位 4、報到序號 5、旅客狀態 1），
// 再來是兩碼十六進位的長度與那麼長的選用欄位（常客號碼、行李件數這類）
export function parseBoardingPass(text: string): BoardingPassContent | null {
  const m = /^M([1-4])(.{20})(.)/.exec(text);
  if (!m) return null;
  const legs: FlightLeg[] = [];
  let at = 23;
  let extra = false;
  for (let i = 0; i < Number(m[1]); i++) {
    const leg = text.slice(at, at + 37);
    const f = /^(.{7})([A-Z]{3})([A-Z]{3})(.{3})(.{5})(\d{3})(.)(.{4})(.{5})(.)([0-9A-Fa-f]{2})$/.exec(leg);
    if (!f) return legs.length ? { kind: "boarding-pass", name: m[2]!.trim(), legs, extra: true } : null;
    const size = parseInt(f[11]!, 16);
    if (size > 0) extra = true;
    legs.push({
      pnr: f[1]!.trim(),
      from: f[2]!,
      to: f[3]!,
      carrier: f[4]!.trim(),
      flight: f[5]!.trim().replace(/^0+(?=\d)/, ""),
      day: Number(f[6]),
      compartment: f[7]!.trim(),
      seat: f[8]!.trim().replace(/^0+(?=\d)/, ""),
    });
    at += 37 + size;
  }
  if (text.length > at) extra = true;
  return { kind: "boarding-pass", name: m[2]!.trim(), legs, extra };
}

// 一年中的第幾天換成月與日，年份用今年（條碼沒有記）
export function dayOfYear(day: number, year = new Date().getFullYear()): { month: number; date: number } {
  const d = new Date(Date.UTC(year, 0, day));
  return { month: d.getUTCMonth() + 1, date: d.getUTCDate() };
}

// GS1 的廠商前綴，代表廠商向哪一個國家的 GS1 申請條碼，不一定是產地。
// 值是 ISO 3166-1 的兩碼代號，由 Intl.DisplayNames 換成該語系的名稱。store 是店內自用
// （秤重的生鮮、店家自己的編號），coupon 是折價券與退款單
const GS1: [number, number, string][] = [
  [0, 19, "US"], [20, 29, "store"], [30, 39, "US"], [40, 49, "store"], [50, 59, "coupon"], [60, 139, "US"],
  [200, 299, "store"], [300, 379, "FR"], [380, 380, "BG"], [383, 383, "SI"], [385, 385, "HR"], [387, 387, "BA"],
  [400, 440, "DE"], [450, 459, "JP"], [460, 469, "RU"], [471, 471, "TW"], [474, 474, "EE"], [475, 475, "LV"],
  [477, 477, "LT"], [479, 479, "LK"], [480, 480, "PH"], [482, 482, "UA"], [489, 489, "HK"], [490, 499, "JP"],
  [500, 509, "GB"], [520, 521, "GR"], [529, 529, "CY"], [539, 539, "IE"], [540, 549, "BE"], [560, 560, "PT"],
  [569, 569, "IS"], [570, 579, "DK"], [590, 590, "PL"], [594, 594, "RO"], [599, 599, "HU"], [600, 601, "ZA"],
  [622, 622, "EG"], [628, 628, "SA"], [629, 629, "AE"], [640, 649, "FI"], [690, 699, "CN"], [700, 709, "NO"],
  [729, 729, "IL"], [730, 739, "SE"], [750, 750, "MX"], [754, 755, "CA"], [760, 769, "CH"], [770, 771, "CO"],
  [779, 779, "AR"], [780, 780, "CL"], [789, 790, "BR"], [800, 839, "IT"], [840, 849, "ES"], [858, 858, "SK"],
  [859, 859, "CZ"], [860, 860, "RS"], [865, 865, "MN"], [868, 869, "TR"], [870, 879, "NL"], [880, 880, "KR"],
  [884, 884, "KH"], [885, 885, "TH"], [888, 888, "SG"], [890, 890, "IN"], [893, 893, "VN"], [896, 896, "PK"],
  [899, 899, "ID"], [900, 919, "AT"], [930, 939, "AU"], [940, 949, "NZ"], [955, 955, "MY"], [958, 958, "MO"],
  [980, 999, "coupon"],
];

const RETAIL = new Set(["EAN13", "EAN8", "UPCA", "UPCE", "ISBN", "EANUPC"]);

export function parseProduct(text: string, format: string): ProductContent | null {
  if (!RETAIL.has(format) || !/^\d{8}$|^\d{12,13}$/.test(text)) return null;
  if (text.length === 8 && format !== "UPCE") return { kind: "product", code: text, type: "EAN-8", region: "" };
  // UPC-A 與 UPC-E 是美國與加拿大的條碼，zxing 會把 UPC-A 補一個 0 讀成 EAN-13
  const code13 = text.length === 12 ? `0${text}` : text.length === 8 ? "" : text;
  if (!code13) return { kind: "product", code: text, type: "UPC", region: "US" };
  const prefix = Number(code13.slice(0, 3));
  if (prefix === 978 || prefix === 979) return { kind: "product", code: code13, type: "ISBN", region: "" };
  if (prefix === 977) return { kind: "product", code: code13, type: "ISSN", region: "" };
  const region = GS1.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? "";
  return { kind: "product", code: code13, type: code13.startsWith("0") ? "UPC" : "EAN-13", region };
}

// 電子發票證明聯的一維條碼（Code 39）：期別 5 碼（民國年 3 碼、雙數月 2 碼）、
// 字軌號碼 10 碼、隨機碼 4 碼，共 19 碼
export function parseInvoiceBarcode(text: string, format: string): InvoiceBarcodeContent | null {
  if (!format.startsWith("Code39")) return null;
  const m = /^(\d{3})(\d{2})([A-Z]{2}\d{8})(\d{4})$/.exec(text.trim());
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 2 || month > 12 || month % 2) return null;
  return { kind: "invoice-barcode", year: Number(m[1]) + 1911, months: [month - 1, month], number: `${m[3]!.slice(0, 2)}-${m[3]!.slice(2)}`, random: m[4]! };
}
