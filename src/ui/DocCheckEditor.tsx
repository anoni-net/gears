import { useEffect, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { type CheckItem, type DocCheck, type HostGroup, checkDocument, groupByHost, hostOf, isUnc } from "../tools/doc-check/index.ts";
import { track, trackFail } from "./analytics.ts";
import type { FileEditorProps } from "./types.ts";

// 文件開啟前檢查：列出文件打開時會連到哪裡、會不會執行程式。只讀檔案的結構，不打開、
// 不執行、不連線（src/tools/doc-check/）。PDF 可以轉成安全的 PDF：每一頁畫成圖片再組回去，
// 跟 Dangerzone 的做法相同，原檔的程式、連結與內嵌的檔案都不會留下（沿用遮蔽的流程）。

function itemTitle(item: CheckItem): string {
  if (item.code === "javascript") return t(item.name === "open" ? "docCheck.code.javascript.open" : "docCheck.code.javascript");
  return tDynamic(`docCheck.code.${item.code}`);
}

function Items({ items }: { items: CheckItem[] }) {
  return (
    <ul class="doc-check-items">
      {items.map((item, i) => (
        <li key={i}>
          <strong>{itemTitle(item)}</strong>
          {item.url ? (
            <>
              {" "}
              <span class="doc-check-host">{hostOf(item.url)}</span>
              <code>{item.url}</code>
            </>
          ) : item.name && item.code !== "javascript" ? (
            <code>{item.name}</code>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// 點了才會連的連結依網域分組。同一個網域的網址收在一起，只有一個網址的直接列出
function LinkGroups({ groups }: { groups: HostGroup[] }) {
  const times = (n: number) => (n > 1 ? <small class="hint"> {t("docCheck.times", { n })}</small> : null);
  return (
    <ul class="doc-check-items doc-check-hosts" data-testid="doc-check-hosts">
      {groups.map((g) => (
        <li key={g.host}>
          {g.urls.length === 1 ? (
            <>
              <span class="doc-check-host">{g.host}</span>
              {times(g.count)}
              <code>{g.urls[0]!.url}</code>
            </>
          ) : (
            <details>
              <summary>
                <span class="doc-check-host">{g.host}</span>
                <small class="hint"> {t("docCheck.hostLinks", { n: g.urls.length, m: g.count })}</small>
              </summary>
              <ul>
                {g.urls.map((u) => (
                  <li key={u.url}>
                    <code>{u.url}</code>
                    {times(u.count)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DocCheckEditor({ blob, format, onDone, onCancel }: FileEditorProps) {
  const [result, setResult] = useState<DocCheck | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const [building, setBuilding] = useState<[number, number] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const check = await checkDocument(new Uint8Array(await blob.arrayBuffer()), format);
      if (!alive) return;
      setResult(check);
      if (check.partial === "broken") trackFail("doc-check", "broken");
      else track("tool-done", { tool: "doc-check" });
    })();
    return () => {
      alive = false;
    };
  }, [blob]);

  // 轉成安全的 PDF：每一頁畫成圖片，組成只有圖片的新 PDF
  const toSafePdf = async () => {
    setStatus("working");
    try {
      const { openPdf, buildRedactedPdf } = await import("./pdf-pages.ts");
      const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
      try {
        const out = await buildRedactedPdf(pdf, [], { check: async () => {}, onProgress: (done, all) => setBuilding([done, all]) });
        onDone(out, { removed: [{ code: "pdf-pages" }], kept: [] });
      } finally {
        pdf.close();
      }
    } catch {
      trackFail("doc-check", "broken");
      setBuilding(null);
      setStatus("failed");
    }
  };

  if (!result) return <p class="hint">{t("docCheck.checking")}</p>;

  const of = (kind: CheckItem["kind"]) => result.items.filter((i) => i.kind === kind);
  const connect = of("connect");
  const code = of("code");
  const links = of("link");
  const linkGroups = groupByHost(links);
  const linkCount = links.reduce((sum, i) => sum + (i.count ?? 1), 0);
  const embedded = of("embedded");
  const verdict = connect.length ? "connect" : code.length ? "code" : "clean";
  const unc = [...connect, ...links].some((i) => i.url && isUnc(i.url));
  const pdf = format === "pdf";
  const office = ["docx", "xlsx", "pptx", "docm", "xlsm", "pptm", "odt", "ods", "odp", "odg"].includes(format);

  return (
    <div class="doc-check">
      <p class="hint">{t("docCheck.intro")}</p>
      <div class={`email-verdict ${verdict === "clean" ? "pass" : verdict === "connect" ? "fail" : "unclear"}`} role="status" data-testid="doc-check-verdict">
        <strong>{tDynamic(`docCheck.verdict.${verdict}`)}</strong>
        <p>{tDynamic(`docCheck.verdict.${verdict}.detail`, { n: String(connect.length) })}</p>
      </div>
      {result.partial ? (
        <p class="warn" role="note">
          {tDynamic(`docCheck.partial.${result.partial}`)}
        </p>
      ) : null}

      {connect.length ? (
        <section aria-labelledby="doc-check-connect">
          <h3 id="doc-check-connect">{t("docCheck.section.connect")}</h3>
          <Items items={connect} />
          {unc ? <p class="warn">{t("docCheck.unc")}</p> : null}
        </section>
      ) : null}
      {code.length ? (
        <section aria-labelledby="doc-check-code">
          <h3 id="doc-check-code">{t("docCheck.section.code")}</h3>
          <Items items={code} />
        </section>
      ) : null}
      {embedded.length ? (
        <section aria-labelledby="doc-check-embedded">
          <h3 id="doc-check-embedded">{t("docCheck.section.embedded")}</h3>
          <Items items={embedded} />
        </section>
      ) : null}
      {links.length ? (
        <details class="verify-details">
          <summary>{t("docCheck.section.links", { n: String(linkCount), m: String(linkGroups.length) })}</summary>
          <p class="hint">{t("docCheck.linksNote")}</p>
          <LinkGroups groups={linkGroups} />
        </details>
      ) : null}

      <h3>{t("docCheck.section.next")}</h3>
      <p class="hint">{t(pdf ? "docCheck.next.pdf" : office ? "docCheck.next.office" : "docCheck.next.markup")}</p>
      <p class="hint">{t("docCheck.limits")}</p>
      <div class="buttons">
        {pdf ? (
          <button type="button" class="primary" disabled={status === "working"} onClick={toSafePdf}>
            {building
              ? t("redact.workingPage", { n: Math.min(building[0] + 1, building[1]), total: building[1] })
              : status === "working"
                ? t("redact.working")
                : t("docCheck.safePdf")}
          </button>
        ) : null}
        <button type="button" onClick={onCancel}>
          {t("docCheck.back")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("docCheck.safePdfFailed")}
        </p>
      ) : null}
    </div>
  );
}
