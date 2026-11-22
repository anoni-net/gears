import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CONTENT_FINDINGS } from "../core/tool.ts";
import type { TrayFile } from "../core/tray.ts";
import { list, t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { DINO_MB } from "../tools/verify/dino-model.ts";
import type { Evidence } from "../tools/verify/examine.ts";
import { type ImageSig, type SimilarGroup, groupSimilar } from "../tools/verify/similar.ts";
import { canvasReadable } from "./canvas-access.ts";
import { callout } from "./callout.ts";
import { CANCELLED, DinoDownloadError, type DinoProgress, dinoCrashedBefore, dinoDownloadMb, dinoRunner } from "./dino-detect.ts";
import { Icon } from "./Icon.tsx";
import { onPhone } from "./phone.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import { type PrepareResult, type Prepared, SIMILAR_FORMATS, prepareImage } from "./similar-images.ts";
import { type SimilarReport, formatSize, keyTimes, timeText } from "./verify-report.ts";
import { wasmAvailable } from "./wasm.ts";
import { useWorking } from "./working.ts";

// 查證的「相近的圖片」（AGENTS.md「查證」的相似圖片）：暫存區裡讀者加入的圖片，內容相近的分在同一組並排，
// 每張列出解析度、檔案大小、有沒有中繼資料與拍攝時間，讀者自己判斷哪一張比較接近原檔。不顯示相似度或分數。
//
// - PDQ（不用模型）在所有檔案整理完之後自動執行。讀 canvas 之前先檢查（canvas-access.ts），Tor Browser 沒有允許時
//   只比內容完全相同（SHA-256，在需要留意的地方），讀者按「再比對一次」時在點擊的當下再讀一次，網址列才會跳出詢問
// - DINOv2 small 由讀者按下按鈕才下載，順序照遮蔽的「找人名、地址與單位」：先看 WebAssembly，手機與平板先說明，
//   再在點擊的當下讀一次 canvas。記憶體不夠時 sessionStorage 的記號留著，同一個分頁不再出現按鈕（dino-detect.ts）
// - SHA-256 相同的複本只拿第一個來比，其他的在那一張下面註明

interface Item {
  file: TrayFile;
  hash: string;
  evidence: Evidence;
}

type Prep = { kind: "idle" } | { kind: "blocked" } | { kind: "running"; done: number; total: number } | { kind: "done" };
type Model = { kind: "idle" } | { kind: "asking" } | { kind: "running"; progress: DinoProgress | null } | { kind: "done" } | { kind: "failed" } | { kind: "remoteFailed" };

// 同一個原檔的特徵只算一次。讀者加入新的圖片之後，只有新的那幾張要再交給模型
const features = new WeakMap<Blob, Float32Array>();

const blobOf = (f: TrayFile) => f.versions[0]!.blob;

export const similarCandidate = (f: TrayFile) => SIMILAR_FORMATS.includes(f.versions[0]!.format) && !f.versions[0]!.large;

// 縮圖：畫到 canvas 上、不讀回來，HEIC 在不支援的瀏覽器上也看得到（同 url-ocr.ts 的裁切小圖）
function Thumb({ source, label }: { source: HTMLCanvasElement; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")?.drawImage(source, 0, 0);
  }, [source]);
  return <canvas ref={ref} class="similar-thumb" role="img" aria-label={label} />;
}

function Member({ item, prepared, copies, near }: { item: Item; prepared: Prepared; copies: string[]; near: string[] }) {
  const original = item.file.versions[0]!;
  const hasMeta = original.findings.some((f) => !CONTENT_FINDINGS.includes(f.code));
  const { start } = keyTimes(item.evidence);
  const taken = start?.kind === "taken" ? start : undefined;
  return (
    <li class="similar-member">
      <Thumb source={prepared.thumb} label={t("verify.similar.thumb", { name: item.file.name })} />
      <p class="similar-name">{item.file.name}</p>
      <dl class="verify-facts">
        <dt>{t("verify.similar.fact.resolution")}</dt>
        <dd>{t("verify.similar.resolution", { w: prepared.width, h: prepared.height })}</dd>
        <dt>{t("verify.similar.fact.size")}</dt>
        <dd>{formatSize(original.blob.size)}</dd>
        <dt>{t("verify.similar.fact.meta")}</dt>
        <dd>{t(hasMeta ? "verify.similar.meta.yes" : "verify.similar.meta.no")}</dd>
        <dt>{t("verify.similar.fact.taken")}</dt>
        <dd>{taken ? timeText(taken) : t("verify.similar.noTaken")}</dd>
      </dl>
      {copies.length ? <p class="hint">{t("verify.similar.copies", { names: list(copies) })}</p> : null}
      {near.length ? <p class="hint" data-testid="similar-also">{t("verify.similar.alsoNear", { names: list(near) })}</p> : null}
    </li>
  );
}

export function SimilarImages({ items, onReport }: { items: Item[]; onReport: (report: SimilarReport | null) => void }) {
  // SHA-256 相同的只比第一個
  const reps = useMemo(() => items.filter((x, i) => items.findIndex((y) => y.hash === x.hash) === i), [items]);
  const copiesOf = (x: Item) => items.filter((y) => y !== x && y.hash === x.hash).map((y) => y.file.name);
  const key = reps.map((x) => x.file.id).join(",");

  const [prep, setPrep] = useState<Prep>({ kind: "idle" });
  const [results, setResults] = useState<Map<number, PrepareResult>>(new Map());
  const [model, setModel] = useState<Model>({ kind: "idle" });
  // 模型算完之後重新分組（特徵存在模組層的 WeakMap 裡，換畫面回來也留著）
  const [, setVersion] = useState(0);
  const runner = useMemo(() => dinoRunner(), []);
  useEffect(() => () => runner.cancel(), [runner]);
  const [crashed] = useState(dinoCrashedBefore);
  // 手機與平板上第一次按下時先展開說明（照遮蔽的 phoneAsk），讀者按「仍要使用」之後這個畫面不再問
  const [phone] = useState(onPhone);
  const [phoneOk, setPhoneOk] = useState(() => !phone);
  const [mb, setMb] = useState<number | null>(null);
  useEffect(() => void dinoDownloadMb().then(setMb), []);
  useWorking(prep.kind === "running" || model.kind === "running");

  const runPrep = async (alive: () => boolean = () => true) => {
    if (!canvasReadable()) {
      setPrep({ kind: "blocked" });
      return;
    }
    let done = 0;
    setPrep({ kind: "running", done, total: reps.length });
    for (const x of reps) {
      const r = await prepareImage(blobOf(x.file));
      if (!alive()) return;
      setResults((prev) => new Map(prev).set(x.file.id, r));
      setPrep({ kind: "running", done: ++done, total: reps.length });
    }
    setPrep({ kind: "done" });
  };

  useEffect(() => {
    let alive = true;
    void runPrep(() => alive);
    return () => {
      alive = false;
    };
  }, [key]);

  const prepared = reps.flatMap((x) => {
    const r = results.get(x.file.id);
    return r && !("error" in r) ? [{ item: x, prepared: r }] : [];
  });
  const skipped = reps.filter((x) => {
    const r = results.get(x.file.id);
    return r && "error" in r;
  });
  const noWasmSkipped = skipped.filter((x) => (results.get(x.file.id) as { error: string }).error === "wasm");
  const decodeSkipped = skipped.filter((x) => !noWasmSkipped.includes(x));
  const embedded = prepared.filter((p) => features.has(blobOf(p.item.file)));
  const missing = prepared.length - embedded.length;
  const ready = prep.kind === "done";

  const groups: SimilarGroup[] = useMemo(() => {
    if (!ready) return [];
    const sigs: ImageSig[] = prepared.map((p) => ({ id: p.item.file.id, pdq: p.prepared.pdq, dino: features.get(blobOf(p.item.file)) }));
    return groupSimilar(sigs);
  }, [ready, key, results, embedded.length]);

  const byId = new Map(prepared.map((p) => [p.item.file.id, p]));
  const nameOf = (id: number) => byId.get(id)!.item.file.name;
  const usedModel = embedded.length > 0;

  // 匯出的查證紀錄用同一份分組
  useEffect(() => {
    if (prep.kind === "blocked") onReport({ blocked: true, groups: [], model: false, skipped: [] });
    else if (!ready) onReport(null);
    else
      onReport({
        blocked: false,
        model: usedModel,
        skipped: skipped.map((x) => x.file.name),
        groups: groups.map((g) => ({
          names: g.ids.map(nameOf),
          layer: g.layer,
          alsoNear: g.alsoNear.map((a) => ({ name: nameOf(a.id), near: a.near.map(nameOf) })),
        })),
      });
  }, [prep.kind, groups]);

  const runModel = async (confirmed = phoneOk) => {
    if (!wasmAvailable()) return;
    if (!confirmed) {
      setModel({ kind: "asking" });
      return;
    }
    setPhoneOk(true);
    // 在點擊的當下讀一次 canvas，Tor Browser 這時才會在網址列跳出詢問
    if (!canvasReadable()) {
      setPrep({ kind: "blocked" });
      setModel({ kind: "idle" });
      return;
    }
    const todo = prepared.filter((p) => !features.has(blobOf(p.item.file)));
    if (!todo.length) return;
    setModel({ kind: "running", progress: null });
    try {
      const out = await runner.run(
        todo.map((p) => p.prepared.pixels),
        (progress) => setModel({ kind: "running", progress }),
      );
      todo.forEach((p, i) => features.set(blobOf(p.item.file), out[i]!));
      setVersion((v) => v + 1);
      setModel({ kind: "done" });
      setMb(0);
    } catch (error) {
      if ((error as Error).message === CANCELLED) return;
      setModel({ kind: error instanceof DinoDownloadError ? "remoteFailed" : "failed" });
    }
  };
  const stopModel = () => {
    runner.cancel();
    setModel({ kind: "idle" });
  };

  const modelStatus = (() => {
    if (model.kind === "running") {
      const p = model.progress;
      if (!p || p.kind === "loading") return t("verify.similar.model.loading");
      if (p.kind === "download") return t("verify.similar.model.downloading", { percent: Math.round((p.loaded / p.total) * 100) });
      return t("verify.similar.model.running", { n: p.done, total: p.total });
    }
    if (model.kind === "failed") return t("verify.similar.model.failed");
    if (model.kind === "remoteFailed") return t("verify.similar.model.remoteFailed");
    if (usedModel && missing) return t("verify.similar.model.pending", { n: missing });
    if (usedModel) return t("verify.similar.model.done", { n: embedded.length });
    return "";
  })();
  const modelProgress = model.kind === "running" && model.progress && model.progress.kind !== "loading" ? (model.progress.kind === "download" ? model.progress.loaded / model.progress.total : model.progress.done / model.progress.total) : null;
  const canStartModel = ready && prepared.length >= 2 && missing > 0 && model.kind !== "running" && model.kind !== "asking";

  return (
    <section aria-labelledby="verify-similar" data-testid="verify-similar" aria-busy={prep.kind === "running" || model.kind === "running"}>
      <h3 id="verify-similar">{t("verify.section.similar")}</h3>
      <p class="hint">{t("verify.similar.intro")}</p>

      {prep.kind === "blocked" ? (
        <div class={callout()} data-testid="similar-blocked">
          <p>{t("verify.similar.blocked")}</p>
          <div class="buttons">
            <button type="button" onClick={() => void runPrep()}>
              {t("verify.similar.retry")}
            </button>
          </div>
        </div>
      ) : null}
      {prep.kind === "running" ? (
        <p class="hint" role="status" data-testid="similar-status">
          {t("verify.similar.working", { n: prep.done, total: prep.total })}
        </p>
      ) : null}

      {ready ? (
        <>
          {groups.length ? (
            <ol class="similar-groups" data-testid="similar-groups">
              {groups.map((g, k) => (
                <li key={g.ids.join(",")} class="similar-group" data-testid="similar-group" data-layer={g.layer}>
                  <h4>{t("verify.similar.group", { n: k + 1, m: g.ids.length })}</h4>
                  <p>{tDynamic(`verify.similar.layer.${g.layer}`)}</p>
                  <ul class="similar-members">
                    {g.ids.map((id) => {
                      const p = byId.get(id)!;
                      return <Member key={id} item={p.item} prepared={p.prepared} copies={copiesOf(p.item)} near={(g.alsoNear.find((a) => a.id === id)?.near ?? []).map(nameOf)} />;
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p class="hint" role="status" data-testid="similar-none">
              {t("verify.similar.none")}
            </p>
          )}
          {decodeSkipped.length ? <p class="hint">{t("verify.similar.skipped", { names: list(decodeSkipped.map((x) => x.file.name)) })}</p> : null}
          {noWasmSkipped.length ? <p class="hint">{t("verify.similar.skippedWasm", { names: list(noWasmSkipped.map((x) => x.file.name)) })}</p> : null}
        </>
      ) : null}

      {/* 整理中先放著模型的說明（按鈕停用），整理完能比的圖不到兩張時拿掉 */}
      {prep.kind !== "blocked" && (!ready || prepared.length >= 2) ? (
        <div class="similar-model" data-testid="similar-model">
          {crashed ? (
            <p class={callout()} data-testid="similar-crashed">
              {t("verify.similar.model.crashed")}
            </p>
          ) : !wasmAvailable() ? (
            <p class="hint" data-testid="similar-nowasm">
              {t("verify.similar.model.noWasm")}
            </p>
          ) : (
            <>
              {!usedModel || missing ? (
                <>
                  {/* 手機上的下載量寫在按下之後的說明裡，同一件事不寫兩次 */}
                  <p class="hint" data-testid="similar-model-note">
                    {!phone && mb ? t("verify.similar.model.note", { mb }) : t("verify.similar.model.noteStored")}
                  </p>
                  <div class="buttons">
                    <button type="button" disabled={!canStartModel} onClick={() => void runModel()}>
                      <span class="tool-tag" aria-hidden="true">
                        <Icon name="brain" />
                      </span>
                      {t("verify.similar.model.button")}
                    </button>
                  </div>
                </>
              ) : null}
              {model.kind === "asking" ? (
                <div class="redact-model-ask" data-testid="similar-model-ask" role="group" aria-label={t("verify.similar.model.button")}>
                  <p>{t("verify.similar.model.phone", { mb: mb || DINO_MB })}</p>
                  <div class="buttons">
                    <button type="button" class="primary" onClick={() => void runModel(true)}>
                      {t("common.phoneGo")}
                    </button>
                    <a class="button" href={routeUrl("testing")} onClick={(e) => onRouteClick(e, () => navigate("testing"))}>
                      {t("common.phoneTest")}
                    </a>
                  </div>
                </div>
              ) : null}
              {modelStatus ? (
                <p class={model.kind === "failed" || model.kind === "remoteFailed" ? "error" : "hint"} role="status" data-testid="similar-model-status">
                  {modelStatus}
                </p>
              ) : null}
              {model.kind === "running" ? (
                <>
                  <ProgressBar label={t("verify.similar.model.button")} value={modelProgress} />
                  <div class="buttons">
                    <button type="button" onClick={stopModel}>
                      {t("verify.similar.model.stop")}
                    </button>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {usedModel ? null : <p class="hint similar-limit">{t("verify.similar.limitPdq")}</p>}
      <p class="hint similar-limit">{t("verify.similar.limit")}</p>
    </section>
  );
}
