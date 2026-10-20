// 遠端傳送的 A 版：向 Cloudflare Realtime 申請 TURN 的短效帳密，配對之後發給兩端（anoni-net/gears#104）。
// TURN key 與 API token 只放在主機上的環境變數檔（tools/relay-compose.yml 的 env_file），不進 repo。
// 申請失敗時回傳 off，兩端照舊只用轉送服務。

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
