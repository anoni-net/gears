// 跟連線有關的內容：Tor bridge、passkey 的跨裝置登入、VPN 與代理的設定、通訊軟體的加好友連結。
// 這幾種都帶著不該外流的東西（bridge 的位址、帳號的密碼）或掃了就會連到別人，
// 畫面上另外提醒（src/ui/QrContentView.tsx）。

export interface Bridge {
  transport: string; // vanilla 是沒有混淆的 bridge
  address: string;
}

export type BridgeContent = { kind: "bridge"; bridges: Bridge[]; lines: string[] };
export type PasskeyContent = { kind: "passkey" };
export type ProxyContent = { kind: "proxy"; protocol: string; server: string; name: string };
export type InviteApp = "Signal" | "Matrix" | "LINE" | "Telegram" | "WhatsApp" | "SimpleX";
export type InviteContent = { kind: "invite"; app: InviteApp; target: "contact" | "group" | "either"; phone: string; url: string };

const TRANSPORTS = ["obfs4", "webtunnel", "snowflake", "meek_lite", "meek", "conjure", "dnstt", "scramblesuit", "obfs3"];

// bridge 一行一個：「傳輸方式 位址:連接埠 指紋 參數…」，沒有混淆的 bridge 沒有傳輸方式。
// torrc 的寫法前面多一個 Bridge。bridges.torproject.org 的 QR code 有的把好幾行寫成
// ['obfs4 …', 'obfs4 …'] 這樣的清單，引號與括號先拿掉
const BRIDGE = new RegExp(`^(?:Bridge\\s+)?(?:(${TRANSPORTS.join("|")})\\s+)?(\\[[0-9a-fA-F:]+\\]:\\d+|[0-9.]+:\\d+)(?:\\s+[0-9A-Fa-f]{40})?(?:\\s+\\S+)*$`);

export function parseBridges(text: string): BridgeContent | null {
  const lines = text
    .replace(/^\s*\[|\]\s*$/g, "")
    .split(/\r?\n|['"]\s*,\s*['"]/)
    .map((line) => line.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const bridges: Bridge[] = [];
  for (const line of lines) {
    const m = BRIDGE.exec(line);
    // 沒有傳輸方式時一定要有指紋，否則任何「IP:連接埠」都會被當成 bridge
    if (!m || (!m[1] && !/\s[0-9A-Fa-f]{40}\b/.test(line))) return null;
    bridges.push({ transport: m[1] ?? "vanilla", address: m[2]! });
  }
  return { kind: "bridge", bridges, lines: lines.map((l) => l.replace(/^Bridge\s+/, "")) };
}

// 用手機的 passkey 登入另一台電腦時，電腦螢幕上顯示的 QR code：FIDO:/ 接一串數字
// （CTAP 2.2 的 hybrid transport，CBOR 編成十進位）
export function parsePasskey(text: string): PasskeyContent | null {
  return /^FIDO:\/\d+$/i.test(text.trim()) ? { kind: "passkey" } : null;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function base64Text(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "") + "=".repeat((4 - (s.length % 4)) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

const PROXIES: Record<string, string> = {
  ss: "Shadowsocks",
  vmess: "VMess",
  vless: "VLESS",
  trojan: "Trojan",
  hysteria2: "Hysteria 2",
  hy2: "Hysteria 2",
  tuic: "TUIC",
};

// 代理的分享連結。帳號、密碼或 UUID 只用來判斷格式，不拆出來顯示
export function parseProxy(text: string): ProxyContent | null {
  const t = text.trim();
  if (/^\[Interface\]/m.test(t) && /^PrivateKey\s*=/m.test(t)) {
    const endpoint = /^Endpoint\s*=\s*(\S+)/m.exec(t)?.[1] ?? "";
    return { kind: "proxy", protocol: "WireGuard", server: endpoint, name: "" };
  }
  const m = /^([a-z0-9]+):\/\/([^#\s]+)(?:#(.*))?$/i.exec(t);
  const protocol = m && PROXIES[m[1]!.toLowerCase()];
  if (!m || !protocol) return null;
  const scheme = m[1]!.toLowerCase();
  let body = m[2]!;
  let name = decode(m[3] ?? "");
  if (scheme === "vmess") {
    const json = base64Text(body);
    if (!json) return null;
    try {
      const v = JSON.parse(json) as { add?: string; port?: string | number; ps?: string };
      return { kind: "proxy", protocol, server: v.add ? `${v.add}:${v.port ?? ""}` : "", name: v.ps ?? name };
    } catch {
      return null;
    }
  }
  // 舊的 Shadowsocks 連結把「加密方式:密碼@主機:連接埠」整串寫成 Base64
  if (scheme === "ss" && !body.includes("@")) body = base64Text(body.split("/")[0]!) ?? "";
  const at = body.lastIndexOf("@");
  if (at < 0) return null;
  const server = /^(\[[^\]]+\]|[^:/?]+):(\d+)/.exec(body.slice(at + 1));
  if (!server) return null;
  return { kind: "proxy", protocol, server: `${server[1]}:${server[2]}`, name };
}

// 通訊軟體的加好友、加入群組連結。照樣是網址，可以交給網址檢查，畫面上另外說明掃了之後
// 對方會看到什麼。電話號碼的連結（signal.me/#p/、wa.me/）把號碼寫在網址裡
export function parseInvite(text: string): InviteContent | null {
  const url = text.trim();
  let u: URL;
  try {
    u = new URL(url.replace(/^sgnl:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const hash = decode(u.hash.slice(1));
  const path = u.pathname;
  const invite = (app: InviteApp, target: InviteContent["target"], phone = ""): InviteContent => ({ kind: "invite", app, target, phone, url });
  if (host === "signal.me") {
    if (hash.startsWith("p/")) return invite("Signal", "contact", hash.slice(2));
    if (hash.startsWith("eu/")) return invite("Signal", "contact");
    return null;
  }
  if (host === "signal.group" && hash) return invite("Signal", "group");
  if (host === "matrix.to" && hash.startsWith("/")) {
    if (hash.startsWith("/@")) return invite("Matrix", "contact");
    if (/^\/[#!]/.test(hash)) return invite("Matrix", "group");
    return null;
  }
  if (host === "line.me") {
    if (/^\/(R\/)?ti\/p\//i.test(path)) return invite("LINE", "contact");
    if (/^\/(R\/)?ti\/g2?\//i.test(path)) return invite("LINE", "group");
    return null;
  }
  if (host === "t.me" || host === "telegram.me") {
    if (/^\/(\+|joinchat\/)/.test(path)) return invite("Telegram", "group");
    if (/^\/\+?\d{6,}$/.test(path)) return invite("Telegram", "contact", path.slice(1));
    if (/^\/[A-Za-z][A-Za-z0-9_]{3,}$/.test(path)) return invite("Telegram", "either");
    return null;
  }
  if (host === "wa.me" && /^\/\d{6,}$/.test(path)) return invite("WhatsApp", "contact", `+${path.slice(1)}`);
  if (host === "chat.whatsapp.com" && path.length > 1) return invite("WhatsApp", "group");
  if (host === "simplex.chat" && /^\/(contact|invitation)/.test(path)) return invite("SimpleX", path.startsWith("/contact") ? "either" : "contact");
  return null;
}
