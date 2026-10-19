import { useEffect, useRef, useState } from "preact/hooks";
import { VIDEO_FORMATS, isMedia, isPhoto } from "../core/bytes.ts";
import { CONTENT_FINDINGS, type Report, type RunOptions, ToolError } from "../core/tool.ts";
import type { TrayFile, Version } from "../core/tray.ts";
import { list, t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { editorTools, fileTools } from "../tools/index.ts";
import { FileEditorView } from "./registry.tsx";
import { IconCircle } from "./Icon.tsx";
import { TOOL_META } from "./tool-meta.ts";
import { useObjectUrl } from "./hooks.ts";
import { QrContentView } from "./QrContentView.tsx";
import { canvasReadable } from "./canvas-access.ts";
import { decodeImage } from "./image-decode.ts";
import { isWasmUnavailable } from "./wasm.ts";
import { PRIVATE_FORMATS, type Scanned, decodeCodeFromBlob } from "./qr-scan.ts";
import { outputName } from "./output-name.ts";
import { CopyButton } from "./CopyButton.tsx";
import { routeUrl } from "../router.ts";
import { track } from "./analytics.ts";
import { type Reason, type ShelfEntry, buildShelf } from "./shelf.ts";
import { useSignals } from "./shelf-signals.ts";

// 預覽圖。Brave、Chrome、Firefox 不能直接顯示 HEIC，載入失敗時改用 libheif 解碼，
// 畫成 PNG 再顯示。解碼也失敗時說明原因，中繼資料照樣能處理
function Preview({ url, blob, format }: { url?: string; blob: Blob; format: Version["format"] }) {
  const [state, setState] = useState<"native" | "decoding" | "decoded" | "broken" | "canvasBlocked" | "noWasm">("native");
  const [decoded, setDecoded] = useState<string>();
  useEffect(() => () => {
    if (decoded) URL.revokeObjectURL(decoded);
  }, [decoded]);

  const fallback = async () => {
    if (format !== "heic") return setState("broken");
    // 解碼之後要從 canvas 輸出成 PNG，瀏覽器不讓讀取時會是一張雜訊圖（見 canvas-access.ts）
    if (!canvasReadable()) return setState("canvasBlocked");
    setState("decoding");
    try {
      const bitmap = await decodeImage(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      bitmap.close();
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("encode");
      setDecoded(URL.createObjectURL(png));
      setState("decoded");
    } catch (error) {
      setState(isWasmUnavailable(error) ? "noWasm" : "broken");
    }
  };

  return (
    <figure class="preview">
      {state === "native" && url ? <img src={url} alt="" onError={fallback} /> : null}
      {state === "decoding" ? <p class="hint">{t("file.decoding")}</p> : null}
      {state === "decoded" ? <img src={decoded} alt="" /> : null}
      {state === "broken" ? <p class="hint">{t("file.noPreview")}</p> : null}
      {state === "canvasBlocked" ? <p class="hint">{t("canvas.blockedPreview")}</p> : null}
      {state === "noWasm" ? <p class="hint">{t("wasm.heicPreview")}</p> : null}
    </figure>
  );
}

// 音訊與影片用瀏覽器內建的播放器。MKV、AVI 這類多半播不了，改成說明。
// 網址自己管：換版本時先讓播放器放掉網址再收回，iOS 的 Safari 才不會去讀已經收回的網址
function MediaPreview({ blob, format }: { blob: Blob; format: Version["format"] }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [url, setUrl] = useState<string>();
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    setBroken(false);
    return () => {
      ref.current?.removeAttribute("src");
      ref.current?.load();
      URL.revokeObjectURL(next);
    };
  }, [blob]);
  if (!url) return null;
  return (
    <figure class="preview media">
      {broken ? (
        <p class="hint">{t("file.noPlayback")}</p>
      ) : VIDEO_FORMATS.includes(format) ? (
        <video ref={ref} src={url} controls preload="metadata" playsInline onError={() => setBroken(true)} />
      ) : (
        <audio ref={ref} src={url} controls preload="metadata" onError={() => setBroken(true)} />
      )}
    </figure>
  );
}

function versionLabel(v: Version) {
  return v.tool ? tDynamic(`file.version.${v.tool}`) : t("file.original");
}

// 跟上一個版本比，說明這一步拿掉了哪些資訊。遮蔽這類會重新編碼的工具，中繼資料是
// 順帶拿掉的，讀者沒有主動要求，不說的話看起來像資料平白消失。
function RemovedNote({ version, previous }: { version: Version; previous?: Version }) {
  if (!previous || !version.tool) return null;
  const now = new Set(version.findings.map((f) => f.code));
  const gone = previous.findings.filter((f) => !now.has(f.code));
  if (!gone.length) return null;
  const reencoded = version.report?.removed.some((r) => r.code === "reencode");
  return (
    <p class="note" data-testid="removed-note">
      {t("findings.removed", { tool: tDynamic(`tool.${version.tool}`), n: gone.length })}
      {reencoded ? t(version.report?.kept.some((r) => r.code === "exif-kept") ? "findings.exifKept" : "findings.reencoded") : null}
    </p>
  );
}

function FindingList({ findings }: { findings: Version["findings"] }) {
  return (
    <ul class="findings">
      {findings.map((f) => (
        <li key={f.code}>
          <span>{tDynamic(`finding.${f.code}`)}</span>
          {f.value ? <code>{f.value}</code> : null}
        </li>
      ))}
    </ul>
  );
}

// 文件的註解與追蹤修訂：預設保留，讀者勾選之後才拿掉
function ContentChoices({ version, busy, onApply }: { version: Version; busy: boolean; onApply?: (options: RunOptions) => void }) {
  const hasComments = version.findings.some((f) => f.code === "doc-comments");
  const hasRevisions = version.findings.some((f) => f.code === "revisions");
  const [removeComments, setRemoveComments] = useState(false);
  const [acceptRevisions, setAcceptRevisions] = useState(false);
  if (!onApply || (!hasComments && !hasRevisions)) return null;
  return (
    <div class="content-choices">
      {hasComments ? (
        <label class="check">
          <input type="checkbox" checked={removeComments} onChange={(e) => setRemoveComments((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            {t("content.removeComments")}
            <small>{t("content.removeCommentsNote")}</small>
          </span>
        </label>
      ) : null}
      {hasRevisions ? (
        <label class="check">
          <input type="checkbox" checked={acceptRevisions} onChange={(e) => setAcceptRevisions((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            {t("content.acceptRevisions")}
            <small>{t("content.acceptRevisionsNote")}</small>
          </span>
        </label>
      ) : null}
      <button
        type="button"
        disabled={busy || (!removeComments && !acceptRevisions)}
        onClick={() => onApply({ removeComments: hasComments && removeComments, acceptRevisions: hasRevisions && acceptRevisions })}
      >
        {t("content.apply")}
      </button>
    </div>
  );
}

// 文件的註解、追蹤修訂與附加檔案是內容，清除之後仍然在，跟中繼資料分開列
function Findings({ version, previous, busy, onApply }: { version: Version; previous?: Version; busy?: boolean; onApply?: (options: RunOptions) => void }) {
  const metadata = version.findings.filter((f) => !CONTENT_FINDINGS.includes(f.code));
  const content = version.findings.filter((f) => CONTENT_FINDINGS.includes(f.code));
  return (
    <>
      {metadata.length ? (
        <FindingList findings={metadata} />
      ) : (
        <>
          <p>{t("findings.none")}</p>
          <p class="hint">{t("findings.scope")}</p>
        </>
      )}
      <RemovedNote version={version} previous={previous} />
      {content.length ? (
        <div class="content-findings" data-testid="content-findings">
          <h4>{t("findings.content")}</h4>
          <FindingList findings={content} />
          <p class="hint">{t("findings.contentNote")}</p>
          <ContentChoices version={version} busy={!!busy} onApply={onApply} key={version.id} />
        </div>
      ) : null}
    </>
  );
}

function ReportView({ report }: { report: Report }) {
  const rows = (items: Report["removed"]) =>
    items.map((item, i) => (
      <li key={i}>
        {/* 字串裡有 {n} 的（例如「沒有選的 3 頁」）直接帶入數量，其他的另外附上「N 個範圍」 */}
        <span>{tDynamic(`segment.${item.code}`, item.count !== undefined ? { n: item.count } : undefined)}</span>
        {item.count !== undefined && !tDynamic(`segment.${item.code}`).includes("{n}") ? <small>{t("report.count", { n: item.count })}</small> : null}
        {item.bytes !== undefined ? <small>{t("report.bytes", { n: item.bytes.toLocaleString() })}</small> : null}
      </li>
    ));
  return (
    <div class="report">
      {report.removed.length ? (
        <div>
          <h4>{t("report.removed")}</h4>
          <ul>{rows(report.removed)}</ul>
        </div>
      ) : null}
      {report.kept.length ? (
        <div>
          <h4>{t("report.kept")}</h4>
          <ul>{rows(report.kept)}</ul>
        </div>
      ) : null}
      {report.notes?.length ? <ul>{rows(report.notes)}</ul> : null}
    </div>
  );
}

// 加密完成之後給對方的說明，跟檔案一起傳過去。收到 .age 檔的人多半不知道要怎麼打開（2026-10-19 的使用回饋）。
// 網址用目前的網站與語系（onion 版就是 onion 的網址），密語不寫進去
function RecipientNote({ version }: { version: Version }) {
  const passphrase = version.report?.notes?.some((n) => n.code === "age-passphrase") ?? false;
  const text = t(passphrase ? "output.recipient.passphrase" : "output.recipient.key", { url: `${location.origin}${routeUrl("decrypt")}` });
  return (
    <div class="recipient-note" data-testid="recipient-note">
      <h4>{t("output.recipient.title")}</h4>
      <p class="hint">{t(passphrase ? "output.recipient.hintPassphrase" : "output.recipient.hintKey")}</p>
      <blockquote>{text}</blockquote>
      <CopyButton text={text} label={t("output.recipient.copy")} primary={false} />
    </div>
  );
}

function Output({ version, name }: { version: Version; name: string }) {
  const url = useObjectUrl(version.blob);
  const file = new File([version.blob], name, { type: version.blob.type });
  const canShare = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  return (
    <section class="output" aria-labelledby="output-title">
      <h3 id="output-title">{t("output.title")}</h3>
      <div class="buttons">
        <a class="button primary" href={url} download={name} onClick={() => track("save", { how: "download" })}>
          {t("output.download")}
        </a>
        {canShare ? (
          <button
            type="button"
            onClick={() =>
              navigator
                .share({ files: [file] })
                .then(() => track("save", { how: "share" }))
                .catch(() => {})
            }
          >
            {t("output.share")}
          </button>
        ) : null}
      </div>
      <p class="hint">{t("output.nameNote")}</p>
      {version.tool === "encrypt" ? <RecipientNote version={version} /> : null}
    </section>
  );
}

const reasonText = (reason: Reason) =>
  tDynamic(`shelf.reason.${reason.key}`, {
    n: reason.n ?? 0,
    findings: list((reason.findings ?? []).map((code) => tDynamic(`finding.${code}`))),
  });

// 清除中繼資料不接受這種檔案時的說明。收到的信件、有巨集的文件、簽章檔指向下面對的工具
function noInspectMessage(version: Version, signature: boolean) {
  if (version.large) return "file.tooLarge" as const;
  if (version.format === "age") return "file.encrypted" as const;
  if (["docm", "xlsm", "pptm"].includes(version.format)) return "file.macro" as const;
  if (version.format === "eml") return "file.email" as const;
  if (signature) return "file.signature" as const;
  return "file.unsupported" as const;
}

function ShelfItem({ entry, busy, onAct }: { entry: ShelfEntry; busy: boolean; onAct(): void }) {
  const { id, kind, actionable, applied, reason } = entry;
  const label = kind === "create" ? t("tools.open") : tDynamic(`tool.${id}.${applied && kind === "editor" ? "again" : "action"}`);
  return (
    <li class={reason ? "recommended" : undefined}>
      <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
      <span class="shelf-name">
        <strong>{tDynamic(`tool.${id}`)}</strong>
        {applied ? <span class="badge done">{t("tools.done")}</span> : null}
        {reason ? <span class="badge">{t("tools.recommended")}</span> : null}
        {reason ? <small class="reason">{reasonText(reason)}</small> : null}
        <small>{tDynamic(`tool.${id}.desc`)}</small>
      </span>
      {/* 處理檔案的工具沒有東西可處理時不顯示按鈕，免得讀者以為還要按。需要編輯畫面的工具可以再做一次 */}
      {!actionable ? (
        applied ? null : <span class="hint nothing">{t("tools.nothing")}</span>
      ) : (
        <button type="button" class={reason ? "primary" : ""} disabled={busy} onClick={onAct}>
          {busy && kind === "file" ? t("tools.busy") : label}
        </button>
      )}
    </li>
  );
}

interface Props {
  file: TrayFile;
  others: TrayFile[]; // 暫存區裡的所有檔案，工具列表用來找成對的簽章檔
  index: number;
  busy: boolean;
  preferred?: string; // 從工具的網址進來時，那個工具排在最前面
  onOpenTool(id: string, preset?: string): void;
}

// 圖片裡的 QR code 與條碼任何人拍到都讀得出來，登機證、票券上的常帶有個資，所以自動讀一次。
// 商品條碼不找（PRIVATE_FORMATS），照片裡常拍到包裝
function QrInImage({ blob, onOpenTool }: { blob: Blob; onOpenTool: Props["onOpenTool"] }) {
  const [found, setFound] = useState<Scanned | null>(null);
  useEffect(() => {
    let alive = true;
    setFound(null);
    // 瀏覽器不讓讀取 canvas 時（Tor Browser）不顯示，讀者沒有要求讀 QR code
    void decodeCodeFromBlob(blob, PRIVATE_FORMATS).then((result) => alive && setFound(result), () => {});
    return () => {
      alive = false;
    };
  }, [blob]);
  if (found === null) return null;
  return (
    <section class="qr-found" aria-labelledby="qr-found-title">
      <h3 id="qr-found-title">{t(found.format === "QRCode" ? "qrread.inImage" : "qrread.inImageBarcode")}</h3>
      <p class="hint">{t("qrread.inImageNote")}</p>
      <QrContentView text={found.text} format={found.format} onOpenTool={onOpenTool} />
    </section>
  );
}

export function FileView({ file, others, index, busy, preferred, onOpenTool }: Props) {
  const current = file.versions.at(-1)!;
  const isImage = isPhoto(current.format);
  const media = isMedia(current.format);
  // 大檔案只交給支援大檔案的工具。遮蔽、加密這類編輯工具會把整個檔案讀進記憶體，
  // 逐字稿可以分段解碼（acceptsLarge）
  const usable = (tool: { accepts(f: Version["format"]): boolean; acceptsLarge?(f: Version["format"]): boolean }) =>
    current.large ? !!tool.acceptsLarge?.(current.format) : tool.accepts(current.format);
  const canInspect = fileTools.some(usable);
  const preview = useObjectUrl(isImage ? current.blob : undefined);
  const [error, setError] = useState<string>();
  // 從編輯類工具的網址進來（例如遮蔽的任務），選好檔案就直接打開編輯畫面
  const [editing, setEditing] = useState<string | null>(() =>
    editorTools.some((tool) => tool.id === preferred && tool.accepts(current.format)) && current.tool !== preferred ? preferred! : null,
  );
  // 編輯畫面固定用打開時的那個版本。套用之後新版本先加進暫存區、編輯畫面才關掉，中間把新版本傳進去的話，
  // 編輯畫面會用新的檔案重新開啟一次（PDF 會再建一個 pdf.js 的 Worker，WebKit 在 COEP 底下擋下）
  const base = useRef<Version>(current);
  const section = useRef<HTMLElement>(null);
  if (!editing) base.current = current;

  const run = async (toolId: string, options?: RunOptions) => {
    const tool = fileTools.find((x) => x.id === toolId)!;
    setError(undefined);
    try {
      await tray.apply(file.id, tool, options);
    } catch (e) {
      setError(
        e instanceof ToolError
          ? t(e.reason === "broken" ? "tool.error.broken" : "tool.error.unsupported")
          : t("tool.error.verify"),
      );
    }
  };


  // 能處理這個檔案的工具，照桌面的三組排列，最多兩個建議（src/ui/shelf.ts）
  const signals = useSignals(current);
  const groups = buildShelf({ file, others, preferred, signals });
  // 從空白開始的工具：查證整理的就是暫存區的檔案，其他的把這個檔案帶過去
  const openCreate = (id: string) => onOpenTool(id, id === "verify" ? undefined : `tray:${file.id}`);
  const act = (entry: ShelfEntry) =>
    entry.kind === "create" ? openCreate(entry.id) : entry.kind === "editor" ? setEditing(entry.id) : void run(entry.id);

  return (
    <section class="file" aria-labelledby="file-title" ref={section}>
      <h2 id="file-title">{file.name}</h2>
      {file.sample ? (
        <p class="hint" data-testid="sample-note">
          {t("file.sample")}
        </p>
      ) : null}

      <ol class="versions" aria-label={t("file.versions")}>
        {file.versions.map((v) => (
          <li key={v.id} aria-current={v === current ? "step" : undefined}>
            {versionLabel(v)}
          </li>
        ))}
      </ol>

      {editing ? (
        <section class="editor" aria-labelledby="editor-title">
          <h3 id="editor-title" class="tool-title">
            <IconCircle name={TOOL_META[editing]!.icon} cat={TOOL_META[editing]!.cat} />
            {tDynamic(`tool.${editing}`)}
          </h3>
          <FileEditorView
            id={editing}
            blob={base.current.blob}
            format={base.current.format}
            onCancel={() => setEditing(null)}
            onDone={(blob, report) => {
              setError(undefined);
              tray
                .addVersion(file.id, blob, editing, report)
                .then(() => {
                  setEditing(null);
                  // 編輯畫面很長，套用的按鈕在底部。關掉之後畫面變短，停在原處的話看到的是工具列表，
                  // 捲回檔案的開頭，預覽與下載就在眼前
                  if ((section.current?.getBoundingClientRect().top ?? 0) < 0) section.current?.scrollIntoView({ block: "start" });
                })
                .catch(() => setError(t("tool.error.verify")));
            }}
          />
          {error ? (
            <p class="error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : (
      // processed：手機上處理完的預覽排在前面，遮蔽完馬上看得到框有沒有蓋對（styles.css）
      <div class={`columns${isImage || media ? "" : " single"}${current.tool ? " processed" : ""}`}>
        {isImage ? <Preview url={preview} blob={current.blob} format={current.format} key={preview} /> : null}
        {media ? <MediaPreview blob={current.blob} format={current.format} /> : null}

        <div class="panel">
          {canInspect ? (
            <>
              <h3>{t("findings.title")}</h3>
              <Findings
                version={current}
                previous={file.versions.at(-2)}
                busy={busy}
                onApply={current.large ? undefined : (options) => void run("strip-metadata", options)}
              />
            </>
          ) : (
            <p class="note">{t(noInspectMessage(current, !!signals.signature))}</p>
          )}

          {/* 處理完的下載放在工具列表之前。原本在最後面，手機上要捲過好幾組工具才看得到，
              最顯眼的按鈕反而是建議的下一個工具（2026-10-19 的使用回饋） */}
          {current.tool ? <Output version={current} name={outputName(file, index)} /> : null}
          {current.report ? <ReportView report={current.report} /> : null}
          {file.versions.length > 1 ? (
            <p class="actions">
              <button type="button" onClick={() => tray.undo(file.id)} disabled={busy}>
                {t("file.undo")}
              </button>
            </p>
          ) : null}

          {isImage && file.versions[0]!.tool === null ? <QrInImage blob={current.blob} onOpenTool={onOpenTool} /> : null}

          <h3>{t("tools.title")}</h3>
          {groups.map((group) => (
            <div class="shelf-group" key={group.id}>
              <h4>{tDynamic(`desk.group.${group.id}`)}</h4>
              <ul class="shelf">
                {group.entries.map((entry) => (
                  <ShelfItem key={entry.id} entry={entry} busy={busy} onAct={() => act(entry)} />
                ))}
              </ul>
            </div>
          ))}
          {error ? (
            <p class="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      )}
    </section>
  );
}
