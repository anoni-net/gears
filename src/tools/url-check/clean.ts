// 清除網址裡的追蹤參數，拆掉轉址包裝。
//
// 只移除認得出來的追蹤參數，其餘一律保留。反過來做的話，YouTube 的 ?v=、搜尋的
// ?q= 會一起被拿掉，讀者拿到打不開的網址也不會馬上發現。做法參考文件站的網址清理器。

// 參數名稱對應到追蹤者，畫面上用來說明「這個參數在告訴誰什麼」
const TRACKERS: Record<string, string> = {
  gclid: "google", dclid: "google", gbraid: "google", wbraid: "google", gclsrc: "google", gad_source: "google",
  fbclid: "meta", igshid: "meta", igsh: "meta", mibextid: "meta", xmt: "meta",
  msclkid: "microsoft",
  twclid: "x", ref_src: "x", ref_url: "x", __twitter_impression: "x",
  ttclid: "tiktok",
  li_fat_id: "linkedin", epik: "pinterest", yclid: "yandex", rdt_cid: "reddit", irclickid: "impact",
  mc_cid: "mailchimp", mc_eid: "mailchimp",
  _hsenc: "hubspot", _hsmi: "hubspot", hsctatracking: "hubspot",
  vero_conv: "vero", vero_id: "vero", ck_subscriber_id: "convertkit",
  si: "share", share_id: "share", share_token: "share",
  spm: "alibaba", scm: "alibaba",
  _openstat: "openstat", wickedid: "wicked",
};

const PREFIXES: [string, string][] = [
  ["utm_", "utm"],
  ["pk_", "matomo"],
  ["piwik_", "matomo"],
  ["mtm_", "matomo"],
  ["hsa_", "hubspot"],
];

// 只在特定網站上才算追蹤的參數。名稱太普通（_t、_r），放進全域清單會誤刪別的網站的功能參數。
const SITE_TRACKERS: { host: RegExp; owner: string; params: string[] }[] = [
  {
    host: /(^|\.)tiktok\.com$/,
    owner: "tiktok",
    params: ["_r", "_t", "is_from_webapp", "sender_device", "sender_web_id", "share_app_id", "share_item_id", "share_link_id", "tt_from", "u_code", "user_id", "sec_user_id", "checksum", "timestamp"],
  },
  { host: /(^|\.)shopee\.[a-z.]+$/, owner: "shopee", params: ["sp_atk", "xptdk", "smtt", "uls_trackid"] },
  { host: /(^|\.)(youtube\.com|youtu\.be)$/, owner: "share", params: ["pp", "feature"] },
  { host: /(^|\.)threads\.(net|com)$/, owner: "meta", params: ["igshid", "xmt", "slof"] },
];

export function trackerOwner(name: string, host: string): string | null {
  const key = name.toLowerCase();
  if (Object.hasOwn(TRACKERS, key)) return TRACKERS[key]!;
  for (const [prefix, owner] of PREFIXES) if (key.startsWith(prefix)) return owner;
  for (const site of SITE_TRACKERS) if (site.host.test(host) && site.params.includes(key)) return site.owner;
  return null;
}

// 轉址包裝：真正的網址就寫在參數裡的那幾種。t.co 這類要連上去才知道指向哪裡，
// 不在這裡處理。
const WRAPPERS: { host: RegExp; path: RegExp; param: string | null }[] = [
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/url$/, param: "q" },
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/url$/, param: "url" },
  { host: /(^|\.)facebook\.com$/, path: /^\/l\.php$/, param: "u" },
  { host: /^l\.facebook\.com$/, path: /.*/, param: "u" },
  { host: /^l\.instagram\.com$/, path: /.*/, param: "u" },
  { host: /^l\.threads\.(net|com)$/, path: /.*/, param: "u" },
  { host: /^away\.vk\.com$/, path: /.*/, param: "to" },
  { host: /^out\.reddit\.com$/, path: /.*/, param: "url" },
  { host: /(^|\.)youtube\.com$/, path: /^\/redirect$/, param: "q" },
  { host: /^href\.li$/, path: /.*/, param: null },
];

function unwrap(url: URL): URL | null {
  for (const rule of WRAPPERS) {
    if (!rule.host.test(url.hostname) || !rule.path.test(url.pathname)) continue;
    const raw = rule.param ? url.searchParams.get(rule.param) : url.search.slice(1);
    if (!raw) continue;
    try {
      const inner = new URL(raw);
      if (inner.protocol === "http:" || inner.protocol === "https:") return inner;
    } catch {
      // 拆不開就當它不是包裝
    }
  }
  return null;
}

// 要連上去才知道指向哪裡的短網址。工作台不替讀者連線，只提醒。
const SHORTENERS = new Set([
  "t.co", "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "is.gd", "rebrand.ly", "cutt.ly", "lnkd.in",
  "reurl.cc", "pse.is", "lihi.cc", "lihi1.cc", "lihi2.cc", "lihi3.cc", "shp.ee", "s.shopee.tw", "lin.ee",
  "fb.me", "on.fb.me", "tiny.cc", "rb.gy", "t.ly", "v.gd", "x.gd", "s.id", "b23.tv", "dwz.cn", "url.cn",
]);

export function isShortener(host: string): boolean {
  return SHORTENERS.has(host.replace(/^www\./, ""));
}

export interface CleanResult {
  url: URL;
  clean: string;
  removed: { name: string; owner: string }[];
  unwrapped: string[];
}

export type ParseError = "empty" | "invalid" | "scheme";

// 讀者常貼進來沒有 https:// 的網址，補上再解析
export function parseUrl(input: string): URL | ParseError {
  const text = input.trim();
  if (!text) return "empty";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "scheme";
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return "invalid";
  return url;
}

export function cleanUrl(input: URL): CleanResult {
  let url = new URL(input.href);
  const unwrapped: string[] = [];
  // 包裝可能疊好幾層，最多拆五層，免得構造出來的網址繞不出去
  for (let i = 0; i < 5; i++) {
    const inner = unwrap(url);
    if (!inner) break;
    unwrapped.push(url.hostname);
    url = inner;
  }
  const removed: CleanResult["removed"] = [];
  for (const name of [...new Set(url.searchParams.keys())]) {
    const owner = trackerOwner(name, url.hostname);
    if (owner) removed.push({ name, owner });
  }
  for (const item of removed) url.searchParams.delete(item.name);
  let clean = url.toString();
  if (!url.searchParams.toString()) clean = clean.replace(/\?(?=#|$)/, "");
  return { url, clean, removed, unwrapped };
}
