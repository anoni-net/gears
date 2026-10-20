// 轉送服務的進入點。建置成 dist-server/relay.mjs（vite.server.config.ts），在主機的容器裡執行
// （tools/relay-compose.yml）。設定從環境變數讀，沒有設的用 relay.ts 的 DEFAULTS。

import { DEFAULTS, type RelayOptions, startRelay } from "./relay.ts";
import { cloudflareIce, coturnIce } from "./turn.ts";

const env = (name: string) => process.env[name];
const number = (name: string, fallback: number) => {
  const v = env(name);
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} 不是正數：${v}`);
  return n;
};

const options: RelayOptions = {
  ...DEFAULTS,
  host: env("RELAY_HOST") || DEFAULTS.host,
  port: number("RELAY_PORT", DEFAULTS.port),
  maxRooms: number("RELAY_MAX_ROOMS", DEFAULTS.maxRooms),
  roomBytes: number("RELAY_ROOM_BYTES", DEFAULTS.roomBytes),
  opensPerClient: number("RELAY_OPENS_PER_CLIENT", DEFAULTS.opensPerClient),
  opensOnion: number("RELAY_OPENS_ONION", DEFAULTS.opensOnion),
};

// A 版的 TURN：自架的 coturn（TURN_SECRET 與 TURN_URLS，逗號分隔）優先，其次是 Cloudflare Realtime
// 的 TURN key，都沒有就不發。RELAY_TEST_ICE=all 只給瀏覽器測試用，不發 TURN、允許區網的位址，
// 同一台機器上的兩個分頁也能建立資料通道
const ttl = Math.round(DEFAULTS.maxAgeMs / 1000);
const turnSecret = env("TURN_SECRET");
const turnUrls = (env("TURN_URLS") ?? "").split(",").map((u) => u.trim()).filter(Boolean);
const keyId = env("CF_TURN_KEY_ID");
const token = env("CF_TURN_KEY_TOKEN");
const turn = turnSecret && turnUrls.length ? "coturn" : keyId && token ? "Cloudflare" : "";
if (turn === "coturn") options.ice = coturnIce(turnSecret!, turnUrls, ttl);
else if (turn === "Cloudflare") options.ice = cloudflareIce(keyId!, token!, ttl);
else if (env("RELAY_TEST_ICE") === "all") options.ice = async () => ({ policy: "all", servers: [] });

const relay = await startRelay(options);
console.log(`gears relay listening on ${relay.url}${turn ? ` (TURN: ${turn})` : ""}`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void relay.close().then(() => process.exit(0));
  });
}
