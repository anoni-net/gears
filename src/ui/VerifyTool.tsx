import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TrayFile } from "../core/tray.ts";
import { list, t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { type Evidence, examine } from "../tools/verify/examine.ts";
import { sha256Blob } from "../tools/verify/hash.ts";
import { type Warning, summarize } from "../tools/verify/summary.ts";
import { CopyButton } from "./CopyButton.tsx";
import { useObjectUrl, useTray } from "./hooks.ts";
import { saveBlob } from "./save.ts";
import type { CreateToolProps } from "./types.ts";
import {
  type CaseEntry,
  buildReport,
  formatSize,
  keyTimes,
  kindText,
  localTime,
  names,
  overviewText,
  peopleText,
  relations,
  sourceText,
  timeText,
  traceLines,
  typeLine,
  warningDetail,
  warningTitle,
} from "./verify-report.ts";

// 查證：把暫存區裡讀者加入的檔案當成一批，整理出每個檔案的重點與檔案之間的關聯，
// 比對出需要留意的地方，可以匯出成查證紀錄。一律讀原檔（第一個版本），不看處理過的版本。
//
// 畫面的順序照讀者想問的：有沒有需要留意的地方、每個檔案是什麼來歷、檔案之間有沒有關聯。
// 雜湊值與完整的時間這類技術資訊收在每個檔案的「完整資訊」裡，匯出的紀錄照樣全部寫出。
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
        {thumbUrl ? <img src={thumbUrl} alt={t("verify.thumbCaption")} /> : null}
        <figcaption>{t("verify.thumbCaption")}</figcaption>
      </figure>
      {mainUrl ? (
        <figure>
          <img src={mainUrl} alt={t("verify.mainCaption")} />
          <figcaption>{t("verify.mainCaption")}</figcaption>
        </figure>
      ) : null}
    </div>
  );
}

// 一列「標籤：內容」
function Fact({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function FileCard(props: { file: TrayFile; entry?: CaseEntry; failed: boolean; warnings: Warning[]; onRevision(end: number, n: number): void }) {
  const { file, entry } = props;
  const original = file.versions[0]!;
  const ev = entry?.evidence;
  const { start, modified } = ev ? keyTimes(ev) : {};
  const traces = ev ? traceLines(ev) : [];
  return (
    <article class="verify-card" aria-label={file.name}>
      <h4>{file.name}</h4>
      <p class="verify-type">
        {typeLine(original.format)} · {formatSize(original.blob.size)}
      </p>
      {props.failed ? <p class="error">{t("verify.failed")}</p> : null}
      {!ev && !props.failed ? <p class="hint">{t("verify.reading")}</p> : null}
      {props.warnings.length ? (
        <p class="verify-card-warn">{t("verify.cardWarnings", { list: list(props.warnings.map(warningTitle)) })}</p>
      ) : null}
      {ev ? (
        <>
          <dl class="verify-facts">
            {start ? <Fact label={kindText(start)}>{timeText(start)}</Fact> : null}
            {modified ? <Fact label={t("verify.fact.modified")}>{timeText(modified)}</Fact> : null}
            {ev.devices.length ? <Fact label={t("verify.device")}>{list(ev.devices)}</Fact> : null}
            {ev.software.length ? <Fact label={t("verify.software")}>{list(ev.software)}</Fact> : null}
            {ev.people.length ? <Fact label={t("verify.fact.people")}>{peopleText(ev)}</Fact> : null}
            {ev.locations.map((l, i) => {
              const text = `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}`;
              return (
                <Fact key={i} label={t("verify.fact.location")}>
                  <code>{text}</code> <CopyButton text={text} primary={false} />
                </Fact>
              );
            })}
            {traces.length ? (
              <Fact label={t("verify.fact.other")}>
                <ul>
                  {traces.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </Fact>
            ) : null}
          </dl>
          {!start && !ev.devices.length && !ev.software.length && !ev.people.length && !ev.locations.length && !traces.length ? (
            <p class="hint">{t("verify.nothing")}</p>
          ) : null}
          {ev.thumbnail ? (
            <div class="verify-block">
              <p>{t("verify.thumbNote")}</p>
              <ThumbCompare file={file} thumbnail={ev.thumbnail} />
            </div>
          ) : null}
          {ev.revisions.length ? (
            <div class="verify-block">
              <p>{t("verify.revisions", { n: ev.revisions.length + 1 })}</p>
              <div class="buttons">
                {ev.revisions.map((end, i) => (
                  <button type="button" key={end} onClick={() => props.onRevision(end, i + 1)}>
                    {t("verify.extractRevision", { n: i + 1 })}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <details class="verify-details">
            <summary>{t("verify.details")}</summary>
            <dl class="verify-facts">
              <Fact label="SHA-256">
                <code data-testid="verify-hash">{entry!.hash}</code> <CopyButton text={entry!.hash ?? ""} primary={false} label={t("verify.copyHash")} />
              </Fact>
              <Fact label={t("verify.fact.added")}>{localTime(file.addedAt)}</Fact>
              {ev.serials.length ? <Fact label={t("verify.serial")}>{list(ev.serials)}</Fact> : null}
              {ev.times.length ? (
                <Fact label={t("verify.fact.allTimes")}>
                  <ul>
                    {ev.times.map((e, i) => (
                      <li key={i}>
                        {timeText(e)}：{kindText(e)}（{sourceText(e)}）
                      </li>
                    ))}
                  </ul>
                </Fact>
              ) : null}
            </dl>
          </details>
        </>
      ) : null}
    </article>
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
        <p class="hint">{t("verify.caveat")}</p>
        <div class="buttons">{picker}</div>
      </div>
    );
  }

  const pending = files.filter((f) => !results.has(f.id) && !failed.has(f.id)).length;
  // 編號依暫存區裡的順序，所有檔案都整理完才算出比對結果，避免數字跟著跳動
  const entries: CaseEntry[] = files.map((f, i) => {
    const r = results.get(f.id);
    return {
      index: i + 1,
      name: f.name,
      format: f.versions[0]!.format,
      size: f.versions[0]!.blob.size,
      hash: r?.hash,
      evidence: r?.evidence ?? { times: [], devices: [], serials: [], software: [], people: [], locations: [], traces: [], revisions: [], signatures: [] },
      addedAt: f.addedAt,
    };
  });
  const ready = entries.filter((e) => results.has(files[e.index - 1]!.id));
  const summary = summarize(ready);
  const rel = relations(summary);

  const exportReport = (toTray: boolean) => {
    const now = Date.now();
    const text = buildReport(ready, summary, now, __GEARS_COMMIT__);
    const stamp = localTime(now).slice(0, 16).replace(/[-: ]/g, "");
    const name = `gears-verify-${stamp}.md`;
    if (toTray) void tray.add([new File([text], name, { type: "text/markdown" })], "verify-report");
    else saveBlob(new Blob([text], { type: "text/markdown" }), name);
  };

  const extractRevision = async (file: TrayFile, end: number, n: number) => {
    const base = file.name.replace(/\.pdf$/i, "");
    await tray.add([new File([file.versions[0]!.blob.slice(0, end)], `${base}-v${n}.pdf`, { type: "application/pdf" })], "verify");
  };

  return (
    <div class="verify">
      <p class="hint">{t("verify.caveat")}</p>

      <section aria-labelledby="verify-overview" class="verify-overview">
        <h3 id="verify-overview">{t("verify.section.overview")}</h3>
        <p role="status">{pending ? t("verify.working", { n: pending }) : overviewText(ready, summary)}</p>
        <div class="buttons">{picker}</div>
      </section>

      {!pending && summary.warnings.length ? (
        <section aria-labelledby="verify-warnings">
          <h3 id="verify-warnings">{t("verify.section.warnings")}</h3>
          <ul class="verify-warnings">
            {summary.warnings.map((w, i) => (
              <li key={i}>
                <strong>{warningTitle(w)}</strong>
                <p>{warningDetail(w, entries)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="verify-files">
        <h3 id="verify-files">{t("verify.section.files")}</h3>
        <div class="verify-cards">
          {files.map((f, i) => (
            <FileCard
              key={f.id}
              file={f}
              entry={results.has(f.id) ? entries[i] : undefined}
              failed={failed.has(f.id)}
              warnings={pending ? [] : summary.warnings.filter((w) => w.files.includes(i + 1))}
              onRevision={(end, n) => void extractRevision(f, end, n)}
            />
          ))}
        </div>
      </section>

      {!pending && files.length > 1 ? (
        <section aria-labelledby="verify-relations">
          <h3 id="verify-relations">{t("verify.section.relations")}</h3>
          {rel.length ? (
            <ul class="verify-relations">
              {rel.map((r, i) => (
                <li key={i}>
                  {r.label}：{r.group.value}
                  <span class="verify-warn-files">{names(entries, r.group.files)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="hint">{t("verify.noRelations")}</p>
          )}
          {summary.timeline.length ? (
            <details class="verify-details">
              <summary>{t("verify.timelineToggle", { n: summary.timeline.length })}</summary>
              <p class="hint">{t("verify.timelineNote")}</p>
              <ol class="verify-timeline">
                {summary.timeline.map((e, i) => (
                  <li key={i}>
                    <time>{timeText(e)}</time>
                    <span>
                      {files[e.file - 1]!.name}，{kindText(e)}（{sourceText(e)}）
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      ) : null}

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
