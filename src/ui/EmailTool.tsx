import { useMemo, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { type Assessment, type Note, assess } from "../tools/email/assess.ts";
import { type Message, parseEmail } from "../tools/email/parse.ts";
import { hostFacts, registrableDomain } from "../tools/url-check/host.ts";
import { findScam } from "../tools/url-check/scam-list.ts";
import type { TimeValue } from "../tools/verify/times.ts";
import type { CreateToolProps } from "./types.ts";
import { useScamList } from "./scam-list-loader.ts";
import { formatSize, timeText } from "./verify-report.ts";

// 看懂這封信：貼上原始郵件或開啟 .eml 檔，用白話說明寄件人是誰、實際從哪裡寄出、
// 寄件驗證有沒有通過、回覆地址有沒有被換掉。只讀信裡已經記下的結果，不連網，
// 信裡的網址交給網址檢查。查證工具讀 .eml 用的是同一套解析（src/tools/email/）。

export function noteTitle(n: Note): string {
  return tDynamic(`email.note.${n.code}.title`);
}

export function noteDetail(n: Note): string {
  const [value, other] = n.times ? n.times.map((x: TimeValue) => timeText(x)) : [n.value ?? "", n.other ?? ""];
  return tDynamic(`email.note.${n.code}.detail`, { value: value!, other: other! });
}

export function verdictTitle(a: Pick<Assessment, "verdict">): string {
  return tDynamic(`email.verdict.${a.verdict}.title`);
}

export function verdictDetail(a: Pick<Assessment, "verdict" | "domain">): string {
  return tDynamic(`email.verdict.${a.verdict}.detail`, { domain: a.domain ?? t("email.unknownDomain") });
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

function Result({ msg, onOpenTool }: { msg: Message; onOpenTool: CreateToolProps["onOpenTool"] }) {
  const a = assess(msg);
  // 附件加入暫存區時留在這個畫面，當成讀者自己加入的原檔，查證時也算進同一批
  const [added, setAdded] = useState<Set<number>>(new Set());
  const addAttachment = async (i: number) => {
    const att = msg.attachments[i]!;
    await tray.add([new File([att.data as Uint8Array<ArrayBuffer>], att.name, { type: att.type })]);
    setAdded((prev) => new Set(prev).add(i));
  };
  const scams = useScamList();
  const facts = a.domain ? hostFacts(new URL(`https://${a.domain}`)) : undefined;
  const scamHit = a.domain && scams ? findScam(a.domain, scams) : null;

  return (
    <div class="email-result">
      <div class={`email-verdict ${a.verdict}`} role="status" data-testid="email-verdict">
        <strong>{verdictTitle(a)}</strong>
        <p>{verdictDetail(a)}</p>
      </div>

      {msg.from ? (
        <section aria-labelledby="email-sender">
          <h3 id="email-sender">{t("email.section.sender")}</h3>
          <dl class="verify-facts">
            {msg.from.name ? (
              <>
                <dt>{t("email.fact.name")}</dt>
                <dd>{msg.from.name}</dd>
              </>
            ) : null}
            <dt>{t("email.fact.address")}</dt>
            <dd>{msg.from.address}</dd>
            {facts ? (
              <>
                <dt>{t("email.fact.domain")}</dt>
                <dd>
                  <strong>{facts.registrableDisplay}</strong>
                  {facts.display !== facts.registrableDisplay ? <small class="hint"> （{facts.display}）</small> : null}
                </dd>
              </>
            ) : null}
            {msg.subject ? (
              <>
                <dt>{t("email.fact.subject")}</dt>
                <dd>{msg.subject}</dd>
              </>
            ) : null}
            {msg.date ? (
              <>
                <dt>{t("email.fact.date")}</dt>
                <dd>{timeText(msg.date)}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      {a.notes.length || scamHit || facts?.warnings.length ? (
        <section aria-labelledby="email-notes">
          <h3 id="email-notes">{t("email.section.notes")}</h3>
          <ul class="verify-warnings">
            {scamHit ? (
              <li>
                <strong>{t("email.scam.title")}</strong>
                <p>{t("email.scam.detail", { domain: scamHit })}</p>
              </li>
            ) : null}
            {facts?.warnings.map((w, i) => (
              <li key={`w${i}`}>
                <strong>{t("email.domainWarning")}</strong>
                <p>{tDynamic(`url.warn.${w.kind}`, { detail: "detail" in w ? w.detail : "" })}</p>
              </li>
            ))}
            {a.notes.map((n, i) => (
              <li key={i}>
                <strong>{noteTitle(n)}</strong>
                <p>{noteDetail(n)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {msg.links.length ? (
        <section aria-labelledby="email-links">
          <h3 id="email-links">{t("email.section.links")}</h3>
          <p class="hint">{t("email.linksNote")}</p>
          <ul class="email-links">
            {msg.links.map((url) => {
              const host = hostOf(url);
              const hit = scams && host ? findScam(host, scams) : null;
              const other = a.domain && host && registrableDomain(host) !== registrableDomain(a.domain);
              return (
                <li key={url}>
                  <span class="email-link-host">
                    <strong>{host || url}</strong>
                    {hit ? <span class="email-badge danger">{t("email.linkScam")}</span> : other ? <span class="email-badge">{t("email.linkOther")}</span> : null}
                  </span>
                  <code>{url}</code>
                  <button type="button" onClick={() => onOpenTool("url-check", url)}>
                    {t("email.checkLink")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {msg.attachments.length ? (
        <section aria-labelledby="email-attachments">
          <h3 id="email-attachments">{t("email.section.attachments")}</h3>
          <ul class="email-attachments">
            {msg.attachments.map((att, i) => (
              <li key={i}>
                <strong>{att.name}</strong> <span class="hint">{`${att.type} · ${formatSize(att.data.length)}`}</span>{" "}
                <button type="button" disabled={added.has(i)} onClick={() => void addAttachment(i)}>
                  {t(added.has(i) ? "email.added" : "email.toTray")}
                </button>
              </li>
            ))}
          </ul>
          <p class="hint">{t("email.attachmentsNote")}</p>
        </section>
      ) : null}

      {a.checks.length ? (
        <details class="verify-details">
          <summary>{t("email.section.auth")}</summary>
          <p class="hint">{t("email.authNote", { server: a.authserv ?? "-" })}</p>
          <ul>
            {a.checks.map((c, i) => (
              <li key={i}>
                {t("email.check", {
                  method: c.method.toUpperCase(),
                  result: c.result,
                  domain: c.domain ?? "-",
                  aligned: t(c.aligned ? "email.aligned" : "email.notAligned"),
                })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {msg.received.length ? (
        <details class="verify-details">
          <summary>{t("email.section.route", { n: msg.received.length })}</summary>
          <p class="hint">{t("email.routeNote")}</p>
          <ol>
            {[...msg.received].reverse().map((h, i) => (
              <li key={i}>
                {t("email.hop", { from: h.from ?? "?", ip: h.ip ?? "-", by: h.by ?? "?" })}
                {h.time ? <small class="hint"> · {timeText(h.time)}</small> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <details class="verify-details">
        <summary>{t("email.section.headers", { n: msg.headers.length })}</summary>
        <pre class="email-headers">{msg.headers.map((h) => `${h.name}: ${h.value}`).join("\n")}</pre>
      </details>
    </div>
  );
}

export function EmailTool({ onOpenTool }: CreateToolProps) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const msg = useMemo(() => (file ? parseEmail(file.bytes) : text.trim() ? parseEmail(text) : null), [file, text]);

  const open = async (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const picked = el.files?.[0];
    el.value = "";
    if (picked) setFile({ name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) });
  };

  return (
    <div class="email-check">
      <p class="hint">{t("email.intro")}</p>
      {file ? (
        <p class="email-file">
          {t("email.opened", { name: file.name })}{" "}
          <button type="button" class="link" onClick={() => setFile(null)}>
            {t("email.clearFile")}
          </button>
        </p>
      ) : (
        <label class="field">
          {t("email.input")}
          <textarea rows={8} value={text} spellcheck={false} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} data-testid="email-input" />
        </label>
      )}
      <div class="buttons">
        <input ref={input} type="file" accept=".eml,message/rfc822,text/plain" hidden onChange={open} data-testid="email-file" />
        <button type="button" onClick={() => input.current?.click()}>
          {t("email.openFile")}
        </button>
        {text && !file ? (
          <button type="button" onClick={() => setText("")}>
            {t("email.clear")}
          </button>
        ) : null}
      </div>
      <details class="verify-details">
        <summary>{t("email.howTo")}</summary>
        <ul>
          {(["gmail", "outlook", "apple", "thunderbird", "proton", "mobile"] as const).map((k) => (
            <li key={k}>{tDynamic(`email.howTo.${k}`)}</li>
          ))}
        </ul>
      </details>
      <p class="hint">{t("email.privacy")}</p>
      {msg ? <Result msg={msg} onOpenTool={onOpenTool} /> : null}
    </div>
  );
}

