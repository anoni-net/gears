// 遠端傳送的分享連結：房間代碼與連結金鑰放在網址的 # 後面（r、k），不會送到伺服器。純邏輯，有單元測試。
//
// 只讀 # 後面，所以 clearnet 與 onion 的連結都能貼到任何一邊的 Gears。onion 版的產物不放 clearnet 的
// 網址（scripts/check-site.mjs），onion 的讀者要傳給沒有 Tor Browser 的人時，對方把連結貼進一般
// 瀏覽器的 Gears 就好。clearnet 的頁面另外給 onion 的連結。

import { ONION_HOST } from "../../site.ts";
import { isId } from "./relay.ts";
import { decodeKey, encodeKey } from "./secure.ts";

export interface Invite {
  room: string;
  key: Uint8Array;
}

export const inviteHash = ({ room, key }: Invite) => `r=${room}&k=${encodeKey(key)}`;

// 整個網址或只有 # 後面都可以。認不得、缺了一段就是 null
export function parseInvite(text: string): Invite | null {
  const trimmed = text.trim();
  const hash = trimmed.includes("#") ? trimmed.slice(trimmed.indexOf("#") + 1) : trimmed;
  const params = new URLSearchParams(hash);
  const room = params.get("r");
  const key = decodeKey(params.get("k") ?? "");
  return isId(room) && key ? { room, key } : null;
}

// onion 版的同一頁。path 是網站根目錄之後的路徑（例如 remote/、en/remote/）
export const onionLink = (path: string, invite: Invite) => `http://gears.${ONION_HOST}/${path}#${inviteHash(invite)}`;
