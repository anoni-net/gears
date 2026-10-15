import { useEffect, useRef, useState } from "preact/hooks";
import { VIDEO_FORMATS, isMedia, isPhoto } from "../core/bytes.ts";
import { CONTENT_FINDINGS, type Report, ToolError } from "../core/tool.ts";
import type { TrayFile, Version } from "../core/tray.ts";
import { t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { editorTools, fileTools } from "../tools/index.ts";
import { FileEditorView } from "./registry.tsx";
import { IconCircle } from "./Icon.tsx";
import { TOOL_META } from "./tool-meta.ts";
import { useObjectUrl } from "./hooks.ts";
import { QrContentView } from "./QrContentView.tsx";
import { decodeImage } from "./image-decode.ts";
import { decodeQrFromBlob } from "./qr-scan.ts";
import { outputName } from "./output-name.ts";

// 預覽圖。Brave、Chrome、Firefox 不能直接顯示 HEIC，載入失敗時改用 libheif 解碼，
// 畫成 PNG 再顯示。解碼也失敗時說明原因，中繼資料照樣能處理
function Preview({ url, blob, format }: { url?: string; blob: Blob; format: Version["format"] }) {
  const [state, setState] = useState<"native" | "decoding" | "decoded" | "broken">("native");
  const [decoded, setDecoded] = useState<string>();
  useEffect(() => () => {
    if (decoded) URL.revokeObjectURL(decoded);
  }, [decoded]);

  const fallback = async () => {
    if (format !== "heic") return setState("broken");
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
    } catch {
      setState("broken");
    }
  };

  return (
    <figure class="preview">
      {state === "native" && url ? <img src={url} alt="" onError={fallback} /> : null}
      {state === "decoding" ? <p class="hint">{t("file.decoding")}</p> : null}
      {state === "decoded" ? <img src={decoded} alt="" /> : null}
      {state === "broken" ? <p class="hint">{t("file.noPreview")}</p> : null}
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
      {reencoded ? t("findings.reencoded") : null}
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

// 文件的註解、追蹤修訂與附加檔案是內容，清除之後仍然在，跟中繼資料分開列
function Findings({ version, previous }: { version: Version; previous?: Version }) {
  const metadata = version.findings.filter((f) => !CONTENT_FINDINGS.includes(f.code));
  const content = version.findings.filter((f) => CONTENT_FINDINGS.includes(f.code));
  return (
    <>
      {metadata.length ? <FindingList findings={metadata} /> : <p class="ok">{t("findings.none")}</p>}
      <RemovedNote version={version} previous={previous} />
      {content.length ? (
        <div class="content-findings" data-testid="content-findings">
          <h4>{t("findings.content")}</h4>
          <FindingList findings={content} />
          <p class="hint">{t("findings.contentNote")}</p>
        </div>
      ) : null}
    </>
  );
}

function ReportView({ report }: { report: Report }) {
  const rows = (items: Report["removed"]) =>
    items.map((item, i) => (
      <li key={i}>
        <span>{tDynamic(`segment.${item.code}`)}</span>
        {item.count !== undefined ? <small>{t("report.count", { n: item.count })}</small> : null}
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

function Output({ version, name }: { version: Version; name: string }) {
  const url = useObjectUrl(version.blob);
  const file = new File([version.blob], name, { type: version.blob.type });
  const canShare = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  return (
    <section class="output" aria-labelledby="output-title">
      <h3 id="output-title">{t("output.title")}</h3>
      <div class="buttons">
        <a class="button primary" href={url} download={name}>
          {t("output.download")}
        </a>
        {canShare ? (
          <button type="button" onClick={() => navigator.share({ files: [file] }).catch(() => {})}>
            {t("output.share")}
          </button>
        ) : null}
      </div>
      <p class="hint">{t("output.nameNote")}</p>
    </section>
  );
}

interface Props {
  file: TrayFile;
  index: number;
  busy: boolean;
  preferred?: string; // 從工具的網址進來時，那個工具排在最前面
  onOpenTool(id: string, preset?: string): void;
}

// 圖片裡的 QR code 任何人拍到都讀得出來，登機證、票券上的常帶有個資，所以自動讀一次
function QrInImage({ blob, onOpenTool }: { blob: Blob; onOpenTool: Props["onOpenTool"] }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    void decodeQrFromBlob(blob).then((found) => alive && setText(found));
    return () => {
      alive = false;
    };
  }, [blob]);
  if (text === null) return null;
  return (
    <section class="qr-found" aria-labelledby="qr-found-title">
      <h3 id="qr-found-title">{t("qrread.inImage")}</h3>
      <p class="hint">{t("qrread.inImageNote")}</p>
      <QrContentView text={text} onOpenTool={onOpenTool} />
    </section>
  );
}

export function FileView({ file, index, busy, preferred, onOpenTool }: Props) {
  const current = file.versions.at(-1)!;
  const isImage = isPhoto(current.format);
  const media = isMedia(current.format);
  // 大檔案只交給支援大檔案的工具，需要編輯畫面的工具（遮蔽、加密）會把整個檔案讀進記憶體
  const usable = (tool: { accepts(f: Version["format"]): boolean; acceptsLarge?(f: Version["format"]): boolean }) =>
    current.large ? !!tool.acceptsLarge?.(current.format) : tool.accepts(current.format);
  const canInspect = fileTools.some(usable);
  const preview = useObjectUrl(isImage ? current.blob : undefined);
  const [error, setError] = useState<string>();
  // 從編輯類工具的網址進來（例如遮蔽的任務），選好檔案就直接打開編輯畫面
  const [editing, setEditing] = useState<string | null>(() =>
    editorTools.some((tool) => tool.id === preferred && tool.accepts(current.format)) && current.tool !== preferred ? preferred! : null,
  );

  const run = async (toolId: string) => {
    const tool = fileTools.find((x) => x.id === toolId)!;
    setError(undefined);
    try {
      await tray.apply(file.id, tool);
    } catch (e) {
      setError(
        e instanceof ToolError
          ? t(e.reason === "broken" ? "tool.error.broken" : "tool.error.unsupported")
          : t("tool.error.verify"),
      );
    }
  };


  // 適用這個格式的工具。能處理目前找到的資訊的標成建議，排在前面
  const found = new Set(current.findings.map((f) => f.code));
  const shelf = [...fileTools.map((tool) => ({ tool, editor: false })), ...editorTools.map((tool) => ({ tool, editor: true }))]
    .filter(({ tool }) => usable(tool))
    .map(({ tool, editor }) => ({
      tool,
      editor,
      recommended: tool.resolves.some((code) => found.has(code)),
      // 看整個版本紀錄，不只看最新的版本：做了別的工具之後，前面處理過的仍然算數
      applied: file.versions.some((v) => v.tool === tool.id),
    }))
    .sort((a, b) => Number(b.tool.id === preferred) - Number(a.tool.id === preferred) || Number(b.recommended) - Number(a.recommended));

  return (
    <section class="file" aria-labelledby="file-title">
      <h2 id="file-title">{file.name}</h2>

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
            blob={current.blob}
            format={current.format}
            onCancel={() => setEditing(null)}
            onDone={(blob, report) => {
              setError(undefined);
              tray
                .addVersion(file.id, blob, editing, report)
                .then(() => setEditing(null))
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
      <div class={isImage || media ? "columns" : "columns single"}>
        {isImage ? <Preview url={preview} blob={current.blob} format={current.format} key={preview} /> : null}
        {media ? <MediaPreview blob={current.blob} format={current.format} /> : null}

        <div class="panel">
          {canInspect ? (
            <>
              <h3>{t("findings.title")}</h3>
              <Findings version={current} previous={file.versions.at(-2)} />
            </>
          ) : (
            <p class="note">{t(current.large ? "file.tooLarge" : current.format === "age" ? "file.encrypted" : "file.unsupported")}</p>
          )}

          {isImage && file.versions[0]!.tool === null ? <QrInImage blob={current.blob} onOpenTool={onOpenTool} /> : null}

          <h3>{t("tools.title")}</h3>
          <ul class="shelf">
            {shelf.map(({ tool, editor, recommended, applied }) => (
              <li key={tool.id}>
                <IconCircle name={TOOL_META[tool.id]!.icon} cat={TOOL_META[tool.id]!.cat} />
                <span class="shelf-name">
                  <strong>{tDynamic(`tool.${tool.id}`)}</strong>
                  {applied ? <span class="badge done">{t("tools.done")}</span> : null}
                  {recommended ? <span class="badge">{t("tools.recommended")}</span> : null}
                  <small>{tDynamic(`tool.${tool.id}.desc`)}</small>
                </span>
                {/* 處理檔案的工具沒有東西可處理時不顯示按鈕，免得讀者以為還要按。需要編輯畫面的工具可以再做一次 */}
                {!editor && !recommended ? (
                  applied ? null : <span class="hint nothing">{t("tools.nothing")}</span>
                ) : (
                  <button
                    type="button"
                    class={recommended ? "primary" : ""}
                    disabled={busy}
                    onClick={() => (editor ? setEditing(tool.id) : run(tool.id))}
                  >
                    {busy ? t("tools.busy") : tDynamic(`tool.${tool.id}.${applied && editor ? "again" : "action"}`)}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {file.versions.length > 1 ? (
            <p class="actions">
              <button type="button" onClick={() => tray.undo(file.id)} disabled={busy}>
                {t("file.undo")}
              </button>
            </p>
          ) : null}
          {error ? (
            <p class="error" role="alert">
              {error}
            </p>
          ) : null}

          {current.report ? <ReportView report={current.report} /> : null}
          {current.tool ? <Output version={current} name={outputName(file, index)} /> : null}
        </div>
      </div>
      )}
    </section>
  );
}
