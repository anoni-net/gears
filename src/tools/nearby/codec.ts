// 面對面傳送的連線描述：把 WebRTC 的 SDP 縮成只帶會變的欄位，放得進一張小的 QR code。
//
// 只開資料通道的 SDP 大部分是固定的行，每次交換真正會變的只有 ICE 的帳密、DTLS 指紋、
// 候選與 setup 角色（anoni-net/docs#553 的結論）。這裡只編這幾個欄位，接收端照固定樣板組回
// 完整的 SDP。純邏輯，網頁版與之後的瀏覽器擴充套件共用。
//
// 封包的排法（版本 1）：
//   0–1   魔術位元組 0x47 0x52（"GR"）
//   2     版本 1
//   3     旗標：bit0–1 setup（0 actpass、1 active、2 passive），bit2 是回應
//   4–5   回應才有：對應的發起描述的標記（發起端 ice-ufrag 的 FNV-1a 折成 16 位元）
//   接著  ice-ufrag、ice-pwd，各一個長度位元組加 ASCII
//   32    DTLS 指紋（SHA-256）
//   1     候選數，每個候選：種類（16 mDNS、4 IPv4、6 IPv6），位址，port（2 位元組）

export const MAGIC = [0x47, 0x52] as const;
export const VERSION = 1;

export type Setup = "actpass" | "active" | "passive";
const SETUPS: Setup[] = ["actpass", "active", "passive"];

export interface Candidate {
  address: string; // mDNS 名稱（UUID.local）、IPv4 或 IPv6
  port: number;
}

export interface Description {
  answer: boolean;
  setup: Setup;
  ufrag: string;
  pwd: string;
  fingerprint: Uint8Array; // 32 位元組
  candidates: Candidate[];
  tag?: number; // 回應才有
}

export class CodecError extends Error {}

// ── 候選 ────────────────────────────────────────────────────────────────────

const MDNS = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

function ipv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map(Number);
  return bytes.every((b, i) => Number.isInteger(b) && b >= 0 && b <= 255 && String(b) === parts[i]) ? bytes : null;
}

function ipv6(address: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(address) || (address.match(/::/g)?.length ?? 0) > 1) return null;
  const [head, tail] = address.includes("::") ? address.split("::") : [address, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]);
}

// 交出去的候選只留可能在區網裡連得到的：
// - 只留 UDP 的 host 候選（不用 STUN 與 TURN，也就不會有 srflx 與 relay）
// - 丟掉 loopback、link-local、CGNAT 的 100.64.0.0/10，以及 Tailscale 的 fd7a:115c:a1e0::/48。
//   流量走 Tailscale 會經過 DERP 中繼繞到網際網路，也不必把這些位址交給對方
export function usable(address: string): boolean {
  if (MDNS.test(address)) return true;
  const v4 = ipv4(address);
  if (v4) {
    const [a, b] = v4 as [number, number];
    if (a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  const v6 = ipv6(address);
  if (v6) {
    if (v6.slice(0, 15).every((x) => x === 0)) return false; // :: 與 ::1
    if (v6[0] === 0xfe && (v6[1]! & 0xc0) === 0x80) return false; // fe80::/10
    if (v6[0] === 0xfd && v6[1] === 0x7a && v6[2] === 0x11 && v6[3] === 0x5c && v6[4] === 0xa1 && v6[5] === 0xe0) return false;
    return true;
  }
  return false;
}

// ── SDP 解析 ────────────────────────────────────────────────────────────────

export function parseSdp(sdp: string, answer: boolean): Description {
  const lines = sdp.split(/\r?\n/);
  const value = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
  if (lines.some((l) => l.startsWith("m=") && !l.startsWith("m=application"))) throw new CodecError("媒體軌");
  const ufrag = value("a=ice-ufrag:");
  const pwd = value("a=ice-pwd:");
  const fp = value("a=fingerprint:");
  const setup = value("a=setup:") as Setup | undefined;
  if (!ufrag || !pwd || !fp || !setup || !SETUPS.includes(setup)) throw new CodecError("缺少欄位");
  const [algo, hex] = fp.split(" ");
  if (algo?.toLowerCase() !== "sha-256" || !hex) throw new CodecError("指紋不是 SHA-256");
  const fingerprint = Uint8Array.from(hex.split(":").map((h) => parseInt(h, 16)));
  if (fingerprint.length !== 32 || fingerprint.some(Number.isNaN)) throw new CodecError("指紋");
  if (ufrag.length > 255 || pwd.length > 255 || /[^\x21-\x7e]/.test(ufrag + pwd)) throw new CodecError("帳密");

  const candidates: Candidate[] = [];
  for (const line of lines) {
    // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> …
    const m = /^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host\b/i.exec(line);
    if (!m) continue;
    const address = m[1]!.toLowerCase();
    if (!usable(address) || candidates.some((c) => c.address === address)) continue;
    candidates.push({ address, port: Number(m[2]) });
  }
  if (!candidates.length) throw new CodecError("沒有可用的候選");
  return { answer, setup, ufrag, pwd, fingerprint, candidates };
}

// ── 組回 SDP ────────────────────────────────────────────────────────────────

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");

export function buildSdp(d: Description, sessionId: string): string {
  const lines = [
    "v=0",
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    // host 候選的優先順序照 RFC 8445 的公式算：type preference 126、component 1，
    // 第一個候選的 local preference 最高
    ...d.candidates.map((c, i) => `a=candidate:${i + 1} 1 udp ${(126 << 24) + ((65535 - i) << 8) + 255} ${c.address} ${c.port} typ host`),
    "a=end-of-candidates",
    `a=ice-ufrag:${d.ufrag}`,
    `a=ice-pwd:${d.pwd}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${Array.from(d.fingerprint, hex2).join(":")}`,
    `a=setup:${d.setup}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

// ── 封包 ────────────────────────────────────────────────────────────────────

// 回應裡帶的標記：發起端換過描述（例如重新開始）時，舊的回應對不上，不會被拿去套用
export function offerTag(ufrag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ufrag.length; i++) {
    h ^= ufrag.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 16) ^ (h & 0xffff);
}

export function encode(d: Description): Uint8Array {
  const out: number[] = [...MAGIC, VERSION, SETUPS.indexOf(d.setup) | (d.answer ? 4 : 0)];
  if (d.answer) out.push((d.tag ?? 0) >> 8, (d.tag ?? 0) & 0xff);
  for (const s of [d.ufrag, d.pwd]) out.push(s.length, ...Array.from(s, (c) => c.charCodeAt(0)));
  out.push(...d.fingerprint);
  out.push(d.candidates.length);
  for (const c of d.candidates) {
    const mdns = MDNS.exec(c.address);
    if (mdns) {
      const hex = mdns.slice(1).join("");
      out.push(16, ...Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
    } else {
      const v4 = ipv4(c.address);
      const bytes = v4 ?? ipv6(c.address);
      if (!bytes) throw new CodecError("候選的位址");
      out.push(v4 ? 4 : 6, ...bytes);
    }
    out.push(c.port >> 8, c.port & 0xff);
  }
  return Uint8Array.from(out);
}

export function decode(bytes: Uint8Array): Description {
  let at = 0;
  const take = (n: number) => {
    if (at + n > bytes.length) throw new CodecError("長度不足");
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const [m0, m1, version, flags] = take(4);
  if (m0 !== MAGIC[0] || m1 !== MAGIC[1]) throw new CodecError("不是工作台的連線描述");
  if (version !== VERSION) throw new CodecError("版本不同");
  const setup = SETUPS[flags! & 3];
  if (!setup) throw new CodecError("setup");
  const answer = (flags! & 4) !== 0;
  const tag = answer ? (take(2)[0]! << 8) | bytes[at - 1]! : undefined;
  const text = () => String.fromCharCode(...take(take(1)[0]!));
  const ufrag = text();
  const pwd = text();
  const fingerprint = Uint8Array.from(take(32));
  const count = take(1)[0]!;
  const candidates: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    const kind = take(1)[0];
    const raw = take(kind === 16 || kind === 6 ? 16 : kind === 4 ? 4 : 0);
    if (!raw.length) throw new CodecError("候選的種類");
    let address: string;
    if (kind === 4) address = Array.from(raw).join(".");
    else {
      const hex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
      address =
        kind === 16
          ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`
          : (hex.match(/.{4}/g)!.map((g) => g.replace(/^0{1,3}/, "")).join(":"));
    }
    const [p0, p1] = take(2);
    candidates.push({ address, port: (p0! << 8) | p1! });
  }
  if (at !== bytes.length) throw new CodecError("多出的位元組");
  return { answer, setup, ufrag, pwd, fingerprint, candidates, ...(answer ? { tag } : {}) };
}

// ── 文字 ────────────────────────────────────────────────────────────────────

// QR code 與複製貼上都用 base64url，可以直接放在網址的 # 後面
export function toText(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromText(text: string): Uint8Array {
  // 讀者貼上的可能是整段網址，取 # 後面的部分
  const code = (text.includes("#") ? text.slice(text.lastIndexOf("#") + 1) : text).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new CodecError("不是工作台的連線描述");
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
