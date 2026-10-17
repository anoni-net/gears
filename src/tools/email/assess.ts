import { registrableDomain } from "../url-check/host.ts";
import type { TimeValue } from "../verify/times.ts";
import type { AuthRecord, Message } from "./parse.ts";

// 這封信是不是真的從它說的地方寄來。只看收件伺服器記在信裡的寄件驗證結果（SPF、DKIM、
// DMARC），跟寄件人的網域對不對得上。
//
// 只相信最上面那一筆 Authentication-Results：它是收件的伺服器寫的。下面的標頭可能是寄件的
// 人自己寫進去的，寫成 pass 也不能信。驗證通過只代表信確實來自那個網域，網域本身可不可信
// （例如長得很像銀行的網域）要另外看。

export type Verdict = "pass" | "fail" | "unclear" | "unrecorded";

export type NoteCode = "reply-to" | "display-name" | "return-path" | "date-skew" | "headers-only" | "body-only" | "dangerous-attachment" | "remote-content";

export interface Note {
  code: NoteCode;
  value?: string;
  other?: string;
  times?: [TimeValue, TimeValue];
}

export interface Assessment {
  verdict: Verdict;
  domain?: string; // 寄件人的網域
  authserv?: string; // 記下驗證結果的伺服器
  checks: { method: "spf" | "dkim" | "dmarc"; result: string; domain?: string; aligned: boolean }[];
  notes: Note[];
}

const PASS = new Set(["pass"]);
const FAIL = new Set(["fail", "softfail", "permerror", "policy"]);

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && registrableDomain(a) === registrableDomain(b);

// 會執行程式或常拿來釣魚的附件類型
const DANGEROUS = /\.(exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|wsf|hta|lnk|msi|jar|iso|img|vhd|html?|svg|docm|xlsm|pptm|one)$/i;

function pickRecord(msg: Message): AuthRecord | undefined {
  return msg.auth.find((r) => !r.arc && r.results.length) ?? msg.auth.find((r) => r.results.length);
}

export function assess(msg: Message): Assessment {
  const domain = msg.from?.domain;
  const record = pickRecord(msg);
  const checks: Assessment["checks"] = [];
  for (const r of record?.results ?? []) {
    if (r.method !== "spf" && r.method !== "dkim" && r.method !== "dmarc") continue;
    const d =
      r.method === "spf"
        ? (r.props["smtp.mailfrom"]?.split("@").pop() ?? r.props["smtp.helo"])
        : r.method === "dkim"
          ? (r.props["header.d"] ?? r.props["header.i"]?.replace(/^@/, "").split("@").pop())
          : r.props["header.from"];
    checks.push({ method: r.method, result: r.result, domain: d?.toLowerCase(), aligned: same(d, domain) });
  }

  let verdict: Verdict = "unrecorded";
  if (checks.length) {
    const dmarc = checks.find((c) => c.method === "dmarc");
    const alignedPass = checks.some((c) => c.method !== "dmarc" && c.aligned && PASS.has(c.result));
    if (dmarc && PASS.has(dmarc.result)) verdict = "pass";
    else if (dmarc && FAIL.has(dmarc.result)) verdict = "fail";
    else if (alignedPass) verdict = "pass";
    else if (checks.some((c) => FAIL.has(c.result))) verdict = "fail";
    else verdict = "unclear";
  }

  const notes: Note[] = [];
  if (!msg.from && !msg.received.length) notes.push({ code: "body-only" });
  else if (!msg.hasBody) notes.push({ code: "headers-only" });
  const reply = msg.replyTo.find((r) => !same(r.domain, domain));
  if (reply && msg.from) notes.push({ code: "reply-to", value: reply.address, other: msg.from.address });
  const shown = msg.from?.name && /[^\s<>"]+@[^\s<>"]+\.[a-z]{2,}/i.exec(msg.from.name)?.[0];
  if (shown && msg.from && shown.toLowerCase() !== msg.from.address.toLowerCase()) notes.push({ code: "display-name", value: shown, other: msg.from.address });
  const bounce = msg.returnPath?.split("@").pop();
  if (bounce && domain && !same(bounce, domain)) notes.push({ code: "return-path", value: bounce.toLowerCase() });
  // 寄出時間由寄件的程式填寫，跟第一站收到的時間差一天以上
  const first = msg.received.at(-1)?.time;
  if (msg.date && first && msg.date.offset && first.offset && Math.abs(first.sort - msg.date.sort) > 24 * 3600000) {
    notes.push({ code: "date-skew", times: [msg.date, first] });
  }
  for (const a of msg.attachments) if (DANGEROUS.test(a.name)) notes.push({ code: "dangerous-attachment", value: a.name });
  // 內文的外部圖片：郵件軟體顯示圖片時就會去抓，寄件的人就知道信被打開了
  if (msg.remote.length) notes.push({ code: "remote-content", value: String(msg.remote.length) });

  return { verdict, domain, authserv: record?.authserv, checks, notes };
}
