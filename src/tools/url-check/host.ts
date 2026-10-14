// 把主機名拆給人看。釣魚網址的常見手法都在主機名上：
//
// - google.com.example.top 把品牌放在子網域
// - shopee-tw-service.com 在品牌旁邊加字
// - аpple.com 用長得像拉丁字母的西里爾字母
//
// 網址列上看起來都很像，把真正的註冊網域單獨標出來，其他部分才看得出是障眼法。

// 兩段式的公共後綴與常見的共用平台。不是完整的 Public Suffix List（上萬條），
// 表裡沒有的就取最後兩段，畫面上有說明這是近似。
const SUFFIXES = new Set([
  "com.tw", "org.tw", "net.tw", "edu.tw", "gov.tw", "idv.tw", "game.tw", "ebiz.tw", "club.tw",
  "com.hk", "org.hk", "net.hk", "edu.hk", "gov.hk", "idv.hk", "com.mo", "org.mo", "gov.mo",
  "com.cn", "org.cn", "net.cn", "edu.cn", "gov.cn",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "co.kr", "or.kr", "ne.kr", "go.kr", "ac.kr",
  "com.sg", "org.sg", "edu.sg", "gov.sg", "com.my", "org.my", "edu.my", "gov.my", "net.my",
  "co.th", "or.th", "in.th", "com.vn", "com.ph", "co.id", "or.id",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "org.au", "net.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "co.in", "org.in", "com.br", "com.mx", "com.ar", "co.za",
  "github.io", "gitlab.io", "pages.dev", "workers.dev", "netlify.app", "vercel.app", "web.app", "firebaseapp.com",
  "blogspot.com", "wordpress.com", "herokuapp.com", "azurewebsites.net", "cloudfront.net", "amazonaws.com",
  "myshopify.com", "wixsite.com", "weebly.com", "notion.site", "ondigitalocean.app", "onrender.com", "replit.app",
]);

// 讀者真的會收到冒充訊息的品牌。本身是常用字的（line、post、gov）不列，誤報比漏報
// 更傷可信度。
const BRANDS = [
  "google", "gmail", "youtube", "facebook", "instagram", "whatsapp", "messenger", "threads",
  "apple", "icloud", "microsoft", "outlook", "office365", "amazon", "netflix", "paypal",
  "telegram", "signal", "twitter", "linkedin", "dropbox", "github", "binance",
  "shopee", "pchome", "momoshop", "ruten", "yahoo", "taobao", "alipay", "wechat", "jkopay", "linepay",
  "esunbank", "cathaybk", "ctbcbank", "taishinbank", "fubon", "megabank", "firstbank",
  "chunghwa", "hinet", "taiwanmobile", "fetnet",
];

// 長得像拉丁字母的西里爾字母（加一個希臘 ο）
const CONFUSABLE = new Set(["а", "е", "о", "р", "с", "у", "х", "і", "ј", "ѕ", "ԛ", "ԁ", "ԝ", "ӏ", "һ", "ԍ", "ѵ", "ѡ", "ο"]);

// RFC 3492 的 Punycode 解碼。瀏覽器只給 xn-- 形式，沒有內建的 API 解回來。
// 輸入是去掉 xn-- 之後的那段，解不開回傳 null。
export function punycodeDecode(input: string): string | null {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const digit = (c: number) => (c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : base);
  const adapt = (delta: number, points: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / points);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  const out: number[] = [];
  const basic = Math.max(0, input.lastIndexOf("-"));
  for (let j = 0; j < basic; j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    out.push(c);
  }
  let n = 128, bias = 72, i = 0;
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const old = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) return null;
      const d = digit(input.charCodeAt(idx++));
      if (d >= base) return null;
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    const len = out.length + 1;
    bias = adapt(i - old, len, old === 0);
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

function scripts(label: string): Set<string> {
  const found = new Set<string>();
  for (const ch of label) {
    const cp = ch.codePointAt(0)!;
    if ((cp < 0x80 && /[a-z]/i.test(ch)) || (cp >= 0xc0 && cp <= 0x24f)) found.add("latin");
    else if (cp >= 0x370 && cp <= 0x3ff) found.add("greek");
    else if (cp >= 0x400 && cp <= 0x52f) found.add("cyrillic");
    else if (cp >= 0x80) found.add("other");
  }
  return found;
}

export type HostWarning =
  | { kind: "userinfo"; detail: string }
  | { kind: "port"; detail: string }
  | { kind: "http" }
  | { kind: "ip"; detail: string }
  | { kind: "idn"; detail: string }
  | { kind: "mixedScript"; detail: string }
  | { kind: "wholeScript"; detail: string }
  | { kind: "brandSubdomain"; detail: string }
  | { kind: "brandLookalike"; detail: string };

export interface HostFacts {
  host: string;
  display: string; // 解開 IDN 之後的樣子
  registrable: string;
  registrableDisplay: string;
  warnings: HostWarning[];
}

export function registrableDomain(host: string): string {
  const labels = host.split(".");
  let take = 2;
  if (labels.length >= 3 && SUFFIXES.has(labels.slice(-2).join("."))) take = 3;
  return labels.slice(-Math.min(take, labels.length)).join(".");
}

export function hostFacts(url: URL): HostFacts {
  const host = url.hostname;
  const facts: HostFacts = { host, display: host, registrable: host, registrableDisplay: host, warnings: [] };
  if (url.username || url.password) facts.warnings.push({ kind: "userinfo", detail: decodeURIComponent(url.username) });
  if (url.port) facts.warnings.push({ kind: "port", detail: url.port });
  if (url.protocol === "http:") facts.warnings.push({ kind: "http" });
  if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    facts.warnings.push({ kind: "ip", detail: host });
    return facts;
  }

  const labels = host.split(".");
  const shown = labels.map((label) => (label.startsWith("xn--") ? (punycodeDecode(label.slice(4)) ?? label) : label));
  facts.display = shown.join(".");
  let idn = false;
  labels.forEach((label, i) => {
    const text = shown[i]!;
    if (text === label) return;
    idn = true;
    const s = scripts(text);
    const lookalike = [...text].every((ch) => CONFUSABLE.has(ch) || /[0-9-]/.test(ch));
    if (s.has("latin") && (s.has("cyrillic") || s.has("greek"))) facts.warnings.push({ kind: "mixedScript", detail: text });
    else if (lookalike && !s.has("latin")) facts.warnings.push({ kind: "wholeScript", detail: text });
  });
  if (idn) facts.warnings.push({ kind: "idn", detail: facts.display });

  facts.registrable = registrableDomain(host);
  const take = facts.registrable.split(".").length;
  facts.registrableDisplay = shown.slice(-take).join(".");

  const head = labels[labels.length - take]!;
  const sub = labels.slice(0, labels.length - take).join(".");
  const brand = BRANDS.find((b) => head !== b && sub.split(".").includes(b));
  if (brand) facts.warnings.push({ kind: "brandSubdomain", detail: brand });
  const near = BRANDS.find((b) => head !== b && new RegExp(`(^|[^a-z])${b}([^a-z]|$)`).test(head));
  if (near) facts.warnings.push({ kind: "brandLookalike", detail: near });
  return facts;
}
