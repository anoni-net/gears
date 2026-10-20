// 轉送服務的進入點。建置成 dist-server/relay.mjs（vite.server.config.ts），在主機的容器裡執行
// （tools/relay-compose.yml）。設定從環境變數讀，沒有設的用 relay.ts 的 DEFAULTS。

import { DEFAULTS, type RelayOptions, startRelay } from "./relay.ts";

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

const relay = await startRelay(options);
console.log(`gears relay listening on ${relay.url}`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void relay.close().then(() => process.exit(0));
  });
}
