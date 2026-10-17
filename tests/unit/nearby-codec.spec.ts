import { expect, test } from "@playwright/test";
import { CodecError, buildSdp, decode, encode, fromText, offerTag, parseSdp, toText, usable } from "../../src/tools/nearby/codec.ts";
import { SDP } from "../helpers/sdp.ts";

for (const [browser, sdp] of Object.entries(SDP)) {
  test(`${browser}：發起與回應的描述縮成封包，解回來完全一樣`, () => {
    for (const [kind, text] of Object.entries(sdp)) {
      const parsed = parseSdp(text, kind === "answer");
      const d = kind === "answer" ? { ...parsed, tag: offerTag("abcd") } : parsed;
      const bytes = encode(d);
      expect(bytes.length, `${kind} ${bytes.length} B`).toBeLessThan(110);
      expect(decode(bytes)).toEqual(d);
      expect(decode(fromText(toText(bytes)))).toEqual(d);
      // Firefox 另外交出 TCP 的候選，只留 UDP
      expect(d.candidates).toHaveLength(1);
      expect(d.candidates[0]!.address).toMatch(/\.local$/);
    }
  });

  test(`${browser}：組回的 SDP 帶著原本的帳密、指紋與候選`, () => {
    const d = parseSdp(sdp.offer, false);
    const rebuilt = buildSdp(d, "123");
    expect(parseSdp(rebuilt, false)).toEqual(d);
    expect(rebuilt).toContain("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
    expect(rebuilt).toContain(`a=ice-ufrag:${d.ufrag}`);
  });
}

test("候選只交出區網連得到的位址", () => {
  for (const ok of ["3f368813-82f5-4604-97ba-3dee44e5a6b1.local", "192.168.1.20", "10.0.0.5", "fd00:1234::1", "2001:db8::5"]) expect(usable(ok), ok).toBe(true);
  // loopback、link-local、CGNAT 與 Tailscale
  for (const no of ["127.0.0.1", "169.254.3.4", "100.64.0.1", "100.127.255.254", "::1", "fe80::1", "fd7a:115c:a1e0::5", "not-an-ip"]) expect(usable(no), no).toBe(false);
  expect(usable("100.128.0.1")).toBe(true);
});

test("區網位址的候選：IPv4 與 IPv6 都編得進去", () => {
  const sdp = SDP.chromium.offer.replace(
    /a=candidate:.*\n/,
    "a=candidate:1 1 udp 2122260223 192.168.1.20 50000 typ host generation 0\na=candidate:2 1 udp 2122260223 100.101.102.103 50001 typ host\na=candidate:3 1 udp 2122194687 fd00:1234::1 50002 typ host\na=candidate:4 1 udp 2122194687 fd7a:115c:a1e0::9 50003 typ host\n",
  );
  const d = parseSdp(sdp, false);
  expect(d.candidates.map((c) => c.address)).toEqual(["192.168.1.20", "fd00:1234::1"]);
  const back = decode(encode(d));
  expect(back.candidates[0]).toEqual({ address: "192.168.1.20", port: 50000 });
  // IPv6 解回來是沒有省略的寫法，瀏覽器一樣接受
  expect(back.candidates[1]).toEqual({ address: "fd00:1234:0:0:0:0:0:1", port: 50002 });
});

test("認得出不是工作台的連線描述", () => {
  expect(() => fromText("https://example.com/menu")).toThrow(CodecError);
  expect(() => decode(fromText(toText(Uint8Array.of(1, 2, 3, 4, 5))))).toThrow(CodecError);
  expect(() => decode(Uint8Array.of(0x47, 0x52, 9, 0))).toThrow(/版本/);
  const bytes = encode(parseSdp(SDP.chromium.offer, false));
  expect(() => decode(bytes.subarray(0, bytes.length - 1))).toThrow(CodecError);
});

test("網址的 # 後面也讀得出來", () => {
  const bytes = encode(parseSdp(SDP.webkit.offer, false));
  expect(decode(fromText(`https://anoni.net/gears/nearby/#${toText(bytes)}`))).toEqual(decode(bytes));
});

test("沒有可用的候選、有媒體軌時不編", () => {
  expect(() => parseSdp(SDP.chromium.offer.replace(/a=candidate:.*\n/, ""), false)).toThrow(/候選/);
  expect(() => parseSdp(`${SDP.chromium.offer}m=audio 9 UDP/TLS/RTP/SAVPF 111\n`, false)).toThrow(/媒體/);
});
