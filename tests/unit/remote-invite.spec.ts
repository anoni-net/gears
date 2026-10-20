import { expect, test } from "@playwright/test";
import { inviteHash, onionLink, parseInvite } from "../../src/tools/remote/invite.ts";
import { randomId } from "../../src/tools/remote/relay.ts";
import { encodeKey, newLinkKey } from "../../src/tools/remote/secure.ts";

const invite = () => ({ room: randomId(), key: newLinkKey() });

test("分享連結的 # 後面讀得回房間代碼與金鑰，整個網址或只有 # 後面都可以", () => {
  const a = invite();
  const hash = inviteHash(a);
  expect(hash).toBe(`r=${a.room}&k=${encodeKey(a.key)}`);
  for (const text of [hash, `#${hash}`, `https://anoni.net/gears/remote/#${hash}`, `  http://gears.x.onion/en/remote/#${hash}\n`])
    expect(parseInvite(text), text).toEqual(a);
});

test("缺了一段、金鑰長度不對、房間代碼不對都認不得", () => {
  const a = invite();
  const key = encodeKey(a.key);
  for (const text of ["", "https://anoni.net/gears/remote/", `r=${a.room}`, `k=${key}`, `r=${a.room}&k=${key.slice(1)}`, `r=short&k=${key}`, "不是連結"])
    expect(parseInvite(text), text).toBeNull();
});

test("onion 的連結在 gears 子網域的根目錄，# 後面相同", () => {
  const a = invite();
  expect(onionLink("en/remote/", a)).toMatch(/^http:\/\/gears\.[a-z2-7]{56}\.onion\/en\/remote\/#r=/);
  expect(parseInvite(onionLink("remote/", a))).toEqual(a);
});
