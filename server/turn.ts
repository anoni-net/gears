// 遠端傳送的 A 版：TURN 的短效帳密，配對之後發給兩端（anoni-net/gears#104）。兩種來源：
//
// - Cloudflare Realtime（試行）：向它的 API 申請，申請失敗時回傳 off，兩端照舊只用轉送服務
// - 自架的 coturn（tools/coturn/）：coturn 的 TURN REST API，用跟 coturn 共用的密鑰在這裡簽，
//   不必連線。username 是「到期時間的 Unix 時間戳:gears」，credential 是用密鑰對 username 算
//   HMAC-SHA1 再轉 base64
//
// 金鑰與密鑰只放在主機上的環境變數檔（tools/relay-compose.yml 的 env_file），不進 repo。

import { createHmac } from "node:crypto";
import { type Ice, type IceServer, NO_ICE } from "../src/tools/remote/relay.ts";

const API = "https://rtc.live.cloudflare.com/v1/turn/keys";

// 只留 TURN：STUN 會讓瀏覽器交出自己的公開 IP，port 53 瀏覽器連不上，只會讓連線多等一次逾時
export function filterIce(servers: unknown): IceServer[] {
  if (!Array.isArray(servers)) return [];
  const out: IceServer[] = [];
  for (const s of servers) {
    const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls]).filter(
      (u: unknown): u is string => typeof u === "string" && /^turns?:/.test(u) && !/:53(\?|$)/.test(u),
    );
    if (!urls.length || typeof s.username !== "string" || typeof s.credential !== "string") continue;
    out.push({ urls, username: s.username, credential: s.credential });
  }
  return out;
}

export function cloudflareIce(keyId: string, token: string, ttl: number): () => Promise<Ice> {
  return async () => {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const servers = filterIce(((await res.json()) as { iceServers?: unknown }).iceServers);
      return servers.length ? { policy: "relay", servers } : NO_ICE;
    } catch (error) {
      // 只記錄失敗的原因，帳密與房間都不寫
      console.error(`TURN credentials failed: ${(error as Error).message}`);
      return NO_ICE;
    }
  };
}

// urls 是 coturn 對外的網址，例如 turn:turn.example:3478?transport=udp 與 turns:turn.example:443?transport=tcp
export function coturnIce(secret: string, urls: string[], ttl: number, now = () => Date.now()): () => Promise<Ice> {
  const turn = urls.filter((u) => /^turns?:/.test(u));
  return async () => {
    const username = `${Math.floor(now() / 1000) + ttl}:gears`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    return turn.length ? { policy: "relay", servers: [{ urls: turn, username, credential }] } : NO_ICE;
  };
}
