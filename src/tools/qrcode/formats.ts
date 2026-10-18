// QR code 的格式清單，產生器與讀取共用，使用統計（src/ui/analytics.ts）也讀這裡。
// 獨立成一個檔案，桌面載入使用統計時不會連帶載入產生與解析的程式

// 產生器的格式，排序依常用的程度
export const QR_MODES = ["text", "wifi", "contact", "event", "geo", "email", "phone", "sms"] as const;
export type QrMode = (typeof QR_MODES)[number];

// 讀取時認得的格式，跟 src/tools/qr-read/index.ts 的 QrContent 一致
export const QR_KINDS = ["url", "wifi", "contact", "email", "phone", "sms", "geo", "event", "otp", "payment", "invoice", "invoice-more", "text"] as const;
export type QrKind = (typeof QR_KINDS)[number];
