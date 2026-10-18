// 付款用的 QR code：台灣 Pay 的共通 QR code（TWQRP://）與 EMVCo 的商家付款碼（東南亞各國的
// PromptPay、PayNow、QRIS、VietQR 這類）。只拆出欄位給讀者核對，不判斷真假。

export type TwPayContent = {
  kind: "twpay";
  type: "pay" | "transfer" | "bill" | "";
  service: string;
  amount: string;
  bank: string;
  account: string;
  merchant: string;
  memo: string;
  expires: string;
};

export type MerchantPayContent = {
  kind: "merchant-pay";
  scheme: string;
  merchant: string;
  city: string;
  country: string; // ISO 3166-1 的兩碼代號
  amount: string;
  currency: string; // ISO 4217 的英文代號，查不到時是數字代號
  crcOk: boolean;
};

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// D12 這類時間是 YYYYMMDDHHMMSS
const timestamp = (s: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(s);
  if (!m) return s;
  return m[4] ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5] ?? "00"}` : `${m[1]}-${m[2]}-${m[3]}`;
};

// 台灣 Pay 的共通 QR code。財金公司沒有公開完整的規格，欄位依社群的逆向工程整理
// （AGENTS.md「QR code 的內容格式」）：TWQRP://服務名稱/158/交易類別/V1?D1=…&D5=…
// 交易類別 01 是掃碼付款、02 是轉帳、03 是繳費。D1 是金額（以分計），D5 與 D6 是
// 轉入的銀行代碼與帳號（左補 0 到 16 碼），D8 是商家名稱，D9 是附言，D12 是有效期限。
// 有的銀行把整串網址百分比編碼
export function parseTwPay(text: string): TwPayContent | null {
  let t = text.trim();
  if (/^TWQRP%3A/i.test(t)) t = decode(t);
  const m = /^TWQRP:\/\/([^/?]*)\/(\d{3})\/(\d{2})\/V\d+\/?(?:\?(.*))?$/is.exec(t);
  if (!m) return null;
  const q = new Map<string, string>();
  for (const pair of (m[4] ?? "").split("&")) {
    const eq = pair.indexOf("=");
    if (eq > 0) q.set(pair.slice(0, eq).toUpperCase(), decode(pair.slice(eq + 1)));
  }
  const types = { "01": "pay", "02": "transfer", "03": "bill" } as const;
  const cents = q.get("D1") ?? "";
  const amount = /^\d+$/.test(cents) ? String(Number(cents) / 100) : "";
  return {
    kind: "twpay",
    type: types[m[3] as keyof typeof types] ?? "",
    service: decode(m[1]!),
    amount,
    bank: q.get("D5") ?? "",
    account: (q.get("D6") ?? "").replace(/^0+(?=\d)/, ""),
    merchant: q.get("D8") ?? "",
    memo: q.get("D9") ?? "",
    expires: q.get("D12") ? timestamp(q.get("D12")!) : "",
  };
}

// EMVCo 的商家付款碼：「兩碼標籤、兩碼長度、內容」一段接一段，00 一定是 01 開頭，
// 最後的 63 是 CRC-16/CCITT-FALSE，從頭算到「6304」為止
function tlv(s: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > s.length) return null;
    out.set(tag, s.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

export function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// 商家帳戶資訊（標籤 26 到 51）裡的 00 是付款網路的識別碼
const SCHEMES: [RegExp, string][] = [
  [/^A000000677/i, "PromptPay"],
  [/^SG\.PAYNOW/i, "PayNow"],
  [/^SG\.COM\.NETS/i, "NETS"],
  [/^ID\.CO\.QRIS/i, "QRIS"],
  [/^A000000727/i, "VietQR"],
  [/^MY\.COM\.PAYNET/i, "DuitNow"],
  [/^HK\.COM\.HKICL/i, "FPS"],
  [/^COM\.P2PQRPAY|^PH\.PPMI/i, "QR Ph"],
  [/^A000000333/i, "UnionPay"],
  [/^A000000003/i, "Visa"],
  [/^A000000004/i, "Mastercard"],
  [/^JP\.OR\.PAYMENTSJAPAN/i, "JPQR"],
  [/^IN\.UPI|^A000000524/i, "UPI"],
];

const CURRENCIES: Record<string, string> = {
  "901": "TWD",
  "764": "THB",
  "702": "SGD",
  "360": "IDR",
  "704": "VND",
  "458": "MYR",
  "344": "HKD",
  "446": "MOP",
  "156": "CNY",
  "392": "JPY",
  "410": "KRW",
  "608": "PHP",
  "356": "INR",
  "840": "USD",
  "978": "EUR",
};

export function parseMerchantPay(text: string): MerchantPayContent | null {
  const t = text.trim();
  if (!t.startsWith("000201")) return null;
  const fields = tlv(t);
  if (!fields || !fields.has("63")) return null;
  let scheme = "";
  for (let tag = 26; tag <= 51 && !scheme; tag++) {
    const info = fields.get(String(tag));
    if (!info) continue;
    const id = tlv(info)?.get("00") ?? info;
    scheme = SCHEMES.find(([re]) => re.test(id))?.[1] ?? id;
  }
  for (const [tag, name] of [["02", "Visa"], ["04", "Mastercard"], ["15", "UnionPay"]] as const) if (!scheme && fields.has(tag)) scheme = name;
  const currency = fields.get("53") ?? "";
  return {
    kind: "merchant-pay",
    scheme,
    merchant: fields.get("59") ?? "",
    city: fields.get("60") ?? "",
    country: fields.get("58") ?? "",
    amount: fields.get("54") ?? "",
    currency: CURRENCIES[currency] ?? currency,
    crcOk: crc16(t.slice(0, t.length - 4)) === fields.get("63")!.toUpperCase(),
  };
}
