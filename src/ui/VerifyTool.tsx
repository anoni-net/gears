import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EXTENSION } from "../core/bytes.ts";
import type { TrayFile } from "../core/tray.ts";
import { t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { type Evidence, examine } from "../tools/verify/examine.ts";
import { sha256Blob } from "../tools/verify/hash.ts";
import { summarize } from "../tools/verify/summary.ts";
import { CopyButton } from "./CopyButton.tsx";
import { useObjectUrl, useTray } from "./hooks.ts";
import { saveBlob } from "./save.ts";
import type { CreateToolProps } from "./types.ts";
import {
  type CaseEntry,
  buildReport,
  fileLabel,
  filesLabel,
  formatSize,
  localTime,
  timeLabel,
  timeText,
  traceLines,
  warningText,
} from "./verify-report.ts";

// 查證：把暫存區裡讀者加入的檔案當成一批，整理出時間線、裝置、人名、位置與編輯痕跡，
// 比對出需要留意的地方，可以匯出成查證紀錄。一律讀原檔（第一個版本），不看處理過的版本。
//
// 查證時從 PDF 取出的舊版本（來源是 verify）也算進來；查證紀錄本身（verify-report）不算。

const inCase = (f: TrayFile) => f.versions[0]!.tool === null || f.versions[0]!.tool === "verify";

interface Result {
  hash: string;
  evidence: Evidence;
}

// 同一個原檔只算一次，換畫面回來不必重算
const cache = new WeakMap<Blob, Promise<Result>>();

function analyze(file: TrayFile): Promise<Result> {
  const original = file.versions[0]!;
  let job = cache.get(original.blob);
  if (!job) {
    job = (async () => {
      const hash = await sha256Blob(original.blob);
      // 太大、沒有整個讀進記憶體的檔案，只用加入暫存區時的檢查結果
      const bytes = original.large ? new Uint8Array(0) : new Uint8Array(await original.blob.arrayBuffer());
      return { hash, evidence: await examine(bytes, original.format, original.findings) };
    })();
    cache.set(original.blob, job);
  }
  return job;
}

const PREVIEWABLE = ["jpeg", "png", "webp", "gif", "avif"];

function ThumbCompare({ file, thumbnail }: { file: TrayFile; thumbnail: Uint8Array }) {
  const original = file.versions[0]!;
  const thumbBlob = useMemo(() => new Blob([thumbnail as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), [thumbnail]);
  const thumbUrl = useObjectUrl(thumbBlob);
  const mainUrl = useObjectUrl(PREVIEWABLE.includes(original.format) ? original.blob : undefined);
  return (
    <div class="verify-thumbs">
      <figure>
        {thumbUrl ? <img src={thumbUrl} alt={t("verify.thumbAlt")} /> : null}
        <figcaption>{t("verify.thumbCaption")}</figcaption>
      </figure>
      {mainUrl ? (
        <figure>
          <img src={mainUrl} alt={t("verify.mainAlt")} />
          <figcaption>{t("verify.mainCaption")}</figcaption>
        </figure>
      ) : null}
    </div>
  );
}

export function VerifyTool(_: CreateToolProps) {
  const state = useTray();
  const files = state.files.filter(inCase);
  const [results, setResults] = useState<Map<number, Result>>(new Map());
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const key = files.map((f) => f.id).join(",");

  useEffect(() => {
    let alive = true;
    for (const file of files) {
      if (results.has(file.id)) continue;
      analyze(file)
        .then((r) => alive && setResults((prev) => new Map(prev).set(file.id, r)))
        .catch(() => alive && setFailed((prev) => new Set(prev).add(file.id)));
    }
    return () => {
      alive = false;
    };
  }, [key]);

  const add = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    void tray.add([...(el.files ?? [])]);
    el.value = "";
  };

  const picker = (
    <>
      <input ref={input} type="file" multiple hidden onChange={add} data-testid="verify-input" />
      <button type="button" class={files.length ? "" : "primary"} onClick={() => input.current?.click()}>
        {t(files.length ? "verify.addMore" : "verify.pick")}
      </button>
    </>
  );

  if (!files.length) {
    return (
      <div class="verify">
        <p class="hint">{t("verify.intro")}</p>
        <div class="buttons">{picker}</div>
      </div>
    );
  }

  const pending = files.filter((f) => !results.has(f.id) && !failed.has(f.id)).length;
  const entries: CaseEntry[] = files
    .map((f, i) => ({ f, i, r: results.get(f.id) }))
    .filter((x) => x.r)
    .map(({ f, i, r }) => ({
      index: i + 1,
      name: f.name,
      format: f.versions[0]!.format,
      size: f.versions[0]!.blob.size,
      hash: r!.hash,
      evidence: r!.evidence,
      addedAt: f.addedAt,
    }));
  const summary = summarize(entries);
  const byIndex = (n: number) => files[n - 1]!;

  const exportReport = (toTray: boolean) => {
    const now = Date.now();
    const text = buildReport(entries, summary, now, __GEARS_COMMIT__);
    const stamp = localTime(now).slice(0, 16).replace(/[-: ]/g, "");
    const name = `gears-verify-${stamp}.md`;
    if (toTray) void tray.add([new File([text], name, { type: "text/markdown" })], "verify-report");
    else saveBlob(new Blob([text], { type: "text/markdown" }), name);
  };

  const extractRevision = async (file: TrayFile, end: number, n: number) => {
    const base = file.name.replace(/\.pdf$/i, "");
    await tray.add([new File([file.versions[0]!.blob.slice(0, end)], `${base}-v${n}.pdf`, { type: "application/pdf" })], "verify");
  };

  const none = <p class="hint">{t("verify.none")}</p>;

  return (
    <div class="verify">
      <p class="hint">{t("verify.intro")}</p>
      <div class="buttons">{picker}</div>
      {pending ? (
        <p class="hint" role="status">
          {t("verify.working", { n: pending })}
        </p>
      ) : null}

      <section aria-labelledby="verify-files">
        <h3 id="verify-files">{t("verify.section.files")}</h3>
        <ul class="verify-files">
          {files.map((f, i) => {
            const r = results.get(f.id);
            return (
              <li key={f.id}>
                <strong>
                  {fileLabel(i + 1)}：{f.name}
                </strong>
                <span>
                  {EXTENSION[f.versions[0]!.format].toUpperCase()} · {formatSize(f.versions[0]!.blob.size)} · {t("verify.addedAt")} {localTime(f.addedAt)}
                </span>
                {failed.has(f.id) ? <span class="error">{t("verify.failed")}</span> : null}
                {r ? (
                  <span class="verify-hash">
                    <code data-testid="verify-hash">SHA-256 {r.hash}</code>
                    <CopyButton text={r.hash} primary={false} label={t("verify.copyHash")} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="verify-warnings">
        <h3 id="verify-warnings">{t("verify.section.warnings")}</h3>
        <p class="hint">{t("verify.warningsNote")}</p>
        {summary.warnings.length ? (
          <ul class="verify-warnings">
            {summary.warnings.map((w, i) => (
              <li key={i}>{warningText(w)}</li>
            ))}
          </ul>
        ) : (
          none
        )}
      </section>

      <section aria-labelledby="verify-timeline">
        <h3 id="verify-timeline">{t("verify.section.timeline")}</h3>
        <p class="hint">{t("verify.timelineNote")}</p>
        {summary.timeline.length ? (
          <ol class="verify-timeline">
            {summary.timeline.map((e, i) => (
              <li key={i}>
                <time>{timeText(e)}</time>
                <span>
                  {fileLabel(e.file)}，{timeLabel(e)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          none
        )}
      </section>

      <section aria-labelledby="verify-devices">
        <h3 id="verify-devices">{t("verify.section.devices")}</h3>
        {summary.devices.length + summary.serials.length + summary.software.length ? (
          <ul class="verify-groups">
            {(
              [
                ["verify.devices", summary.devices],
                ["verify.serials", summary.serials],
                ["verify.software", summary.software],
              ] as const
            ).flatMap(([label, items]) =>
              items.map((g) => (
                <li key={`${label}-${g.value}`}>
                  {t(label)}：{g.value}
                  <small>{filesLabel(g.files)}</small>
                </li>
              )),
            )}
          </ul>
        ) : (
          none
        )}
      </section>

      <section aria-labelledby="verify-people">
        <h3 id="verify-people">{t("verify.section.people")}</h3>
        {summary.people.length ? (
          <ul class="verify-groups">
            {summary.people.map((p) => (
              <li key={`${p.role}-${p.value}`}>
                {t(`verify.role.${p.role}` as never)}：{p.value}
                <small>{filesLabel(p.files)}</small>
              </li>
            ))}
          </ul>
        ) : (
          none
        )}
      </section>

      <section aria-labelledby="verify-locations">
        <h3 id="verify-locations">{t("verify.section.locations")}</h3>
        {summary.locations.length ? (
          <ul class="verify-groups">
            {summary.locations.map((l, i) => {
              const text = `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}`;
              return (
                <li key={i}>
                  <code>{text}</code>
                  <small>{fileLabel(l.file)}</small>
                  <CopyButton text={text} primary={false} />
                </li>
              );
            })}
          </ul>
        ) : (
          none
        )}
      </section>

      <section aria-labelledby="verify-traces">
        <h3 id="verify-traces">{t("verify.section.traces")}</h3>
        {entries.some((e) => traceLines(e).length || e.evidence.thumbnail) ? (
          entries.map((e) => {
            const lines = traceLines(e);
            if (!lines.length && !e.evidence.thumbnail) return null;
            const file = byIndex(e.index);
            return (
              <div class="verify-trace" key={e.index}>
                <h4>
                  {fileLabel(e.index)}：{e.name}
                </h4>
                <ul>
                  {lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {e.evidence.thumbnail ? <ThumbCompare file={file} thumbnail={e.evidence.thumbnail} /> : null}
                {e.evidence.revisions.length ? (
                  <div class="buttons">
                    {e.evidence.revisions.map((end, i) => (
                      <button type="button" key={end} onClick={() => void extractRevision(file, end, i + 1)}>
                        {t("verify.extractRevision", { n: i + 1 })}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          none
        )}
      </section>

      <section aria-labelledby="verify-export">
        <h3 id="verify-export">{t("verify.section.export")}</h3>
        <p class="hint">{t("verify.exportNote")}</p>
        <div class="buttons">
          <button type="button" class="primary" disabled={!!pending} onClick={() => exportReport(false)}>
            {t("verify.download")}
          </button>
          <button type="button" disabled={!!pending} onClick={() => exportReport(true)}>
            {t("verify.toTray")}
          </button>
        </div>
      </section>
    </div>
  );
}
