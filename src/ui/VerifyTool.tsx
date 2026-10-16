import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TrayFile } from "../core/tray.ts";
import { list, t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { type Evidence, examine } from "../tools/verify/examine.ts";
import { type MetaChange, metaChanges } from "../tools/verify/diff.ts";
import { sha256Blob } from "../tools/verify/hash.ts";
import { type Warning, summarize } from "../tools/verify/summary.ts";
import { CopyButton } from "./CopyButton.tsx";
import type { Comparison } from "./pdf-compare.ts";
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
// 只算讀者自己加入的檔案。放進暫存區的查證紀錄（來源是 verify）不算。

const inCase = (f: TrayFile) => f.versions[0]!.tool === null;

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

function DiffImage({ blob, caption }: { blob: Blob; caption: string }) {
  const url = useObjectUrl(blob);
  return (
    <figure>
      {url ? <img src={url} alt={caption} /> : null}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

// 兩個版本的差異：中繼資料、每一頁的文字與畫面
function CompareView({ from, to, before, after }: { from: number; to: number; before: Uint8Array; after: Uint8Array }) {
  const [result, setResult] = useState<Comparison | null>(null);
  const [meta, setMeta] = useState<MetaChange[]>([]);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setResult(null);
    setFailed(false);
    void (async () => {
      const [a, b] = await Promise.all([examine(before, "pdf"), examine(after, "pdf")]);
      if (alive) setMeta(metaChanges(a, b, { time: timeText, list }));
      const { compareVersions } = await import("./pdf-compare.ts");
      const r = await compareVersions(before, after, (done, total) => alive && setProgress([done, total]));
      if (alive) setResult(r);
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [before, after]);

  return (
    <div class="verify-compare" data-testid="verify-compare">
      <h5>{t("verify.compareTitle", { a: from, b: to })}</h5>
      {failed ? <p class="error">{t("verify.compareFailed")}</p> : null}
      {meta.length ? (
        <ul class="verify-meta">
          {meta.map((m) => (
            <li key={m.field}>{t("verify.metaChange", { field: tDynamic(`verify.meta.${m.field}`), before: m.before ?? t("verify.empty"), after: m.after ?? t("verify.empty") })}</li>
          ))}
        </ul>
      ) : null}
      {!result && !failed ? (
        <p class="hint" role="status">
          {progress ? t("verify.comparing", { n: Math.min(progress[0] + 1, progress[1]), total: progress[1] }) : t("verify.reading")}
        </p>
      ) : null}
      {result ? (
        <>
          {result.visualSkipped ? <p class="hint">{t("verify.visualSkipped")}</p> : null}
          {result.pages.length ? null : <p>{t("verify.noDiff")}</p>}
          {result.pages.map((p) => (
            <div class="verify-page-diff" key={p.index}>
              <h6>
                {t("verify.page", { n: p.index + 1 })}：{tDynamic(`verify.pageStatus.${p.status}`)}
              </h6>
              {p.sizeChanged ? <p class="hint">{t("verify.sizeChanged")}</p> : null}
              {p.status === "changed" && !p.text.added.length && !p.text.removed.length ? <p class="hint">{t("verify.visualOnly")}</p> : null}
              {p.text.removed.length || p.text.added.length ? (
                <ul class="verify-text-diff">
                  {p.text.removed.map((line, i) => (
                    <li key={`r${i}`} class="removed">
                      <span class="sr">{t("verify.textRemoved")}</span>− {line}
                    </li>
                  ))}
                  {p.text.added.map((line, i) => (
                    <li key={`a${i}`} class="added">
                      <span class="sr">{t("verify.textAdded")}</span>+ {line}
                    </li>
                  ))}
                </ul>
              ) : null}
              {p.before || p.after ? (
                <div class="verify-thumbs">
                  {p.before ? <DiffImage blob={p.before} caption={t("verify.version", { n: from })} /> : null}
                  {p.after ? <DiffImage blob={p.after} caption={t("verify.version", { n: to })} /> : null}
                </div>
              ) : null}
            </div>
          ))}
          {result.pages.length && result.same ? <p class="hint">{t("verify.samePages", { n: result.same })}</p> : null}
          <p class="hint">{t("verify.compareNote")}</p>
        </>
      ) : null}
    </div>
  );
}

// PDF 的版本紀錄：每一個 %%EOF 是一次存檔，切到那裡就是當時的檔案。列出每個版本的大小、頁數
// 與時間，可以下載，也可以跟下一版比對
function VersionHistory({ file, revisions }: { file: TrayFile; revisions: number[] }) {
  const blob = file.versions[0]!.blob;
  const ends = [...revisions, blob.size];
  const [info, setInfo] = useState<Evidence[]>([]);
  const [pair, setPair] = useState<{ from: number; to: number; before: Uint8Array; after: Uint8Array } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const list = await Promise.all(ends.map((end) => examine(bytes.subarray(0, end), "pdf")));
      if (alive) setInfo(list);
    })();
    return () => {
      alive = false;
    };
  }, [blob]);

  const base = file.name.replace(/\.pdf$/i, "");
  const compare = async (i: number) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    setPair({ from: i + 1, to: i + 2, before: bytes.slice(0, ends[i]!), after: bytes.slice(0, ends[i + 1]!) });
  };

  return (
    <div class="verify-block">
      <p>{t("verify.revisions", { n: ends.length })}</p>
      <p class="hint">{t("verify.revisionsNote")}</p>
      <ol class="verify-versions">
        {ends.map((end, i) => {
          const ev = info[i];
          const { start, modified } = ev ? keyTimes(ev) : {};
          const time = modified ?? start;
          const facts = [formatSize(end), ev?.pages ? t("verify.pageCount", { n: ev.pages }) : null, time ? `${kindText(time)} ${timeText(time)}` : null].filter(Boolean).join(" · ");
          return (
            <li key={end}>
              <strong>
                {t("verify.version", { n: i + 1 })}
                {i === ends.length - 1 ? t("verify.versionCurrent") : ""}
              </strong>
              <span class="verify-type">{facts}</span>
              {i < ends.length - 1 ? (
                <span class="buttons">
                  <button type="button" onClick={() => void compare(i)}>
                    {t("verify.compareWith", { n: i + 2 })}
                  </button>
                  <button type="button" onClick={() => saveBlob(blob.slice(0, end, "application/pdf"), `${base}-v${i + 1}.pdf`)}>
                    {t("verify.downloadVersion", { n: i + 1 })}
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {pair ? <CompareView key={`${pair.from}-${pair.to}`} {...pair} /> : null}
    </div>
  );
}

function FileCard(props: { file: TrayFile; entry?: CaseEntry; failed: boolean; warnings: Warning[] }) {
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
          {ev.revisions.length ? <VersionHistory file={file} revisions={ev.revisions} /> : null}
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
    if (toTray) void tray.add([new File([text], name, { type: "text/markdown" })], "verify");
    else saveBlob(new Blob([text], { type: "text/markdown" }), name);
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
