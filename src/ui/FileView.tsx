import { useEffect, useState } from "preact/hooks";
import { EXTENSION } from "../core/bytes.ts";
import { type Report, ToolError } from "../core/tool.ts";
import type { TrayFile, Version } from "../core/tray.ts";
import { t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { editorTools, fileTools } from "../tools/index.ts";
import { FileEditorView } from "./registry.tsx";
import { useObjectUrl } from "./hooks.ts";
import { QrContentView } from "./QrContentView.tsx";
import { decodeQrFromBlob } from "./qr-scan.ts";

// 下載的檔名不沿用原檔名（常帶有拍攝日期），只決定副檔名。不能預覽的檔案沒有
// 可靠的格式判斷，沿用原檔名的副檔名，解密時先拿掉 .age
function extension(name: string, format: Version["format"]): string {
  if (format !== "unknown") return EXTENSION[format];
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name.replace(/\.age$/i, ""))?.[1];
  return ext ? ext.toLowerCase() : EXTENSION.unknown;
}

function versionLabel(v: Version) {
  return v.tool ? tDynamic(`file.version.${v.tool}`) : t("file.original");
}

function Findings({ version }: { version: Version }) {
  if (!version.findings.length) return <p class="ok">{t("findings.none")}</p>;
  return (
    <ul class="findings">
      {version.findings.map((f) => (
        <li key={f.code}>
          <span>{tDynamic(`finding.${f.code}`)}</span>
          {f.value ? <code>{f.value}</code> : null}
        </li>
      ))}
    </ul>
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
  const isImage = current.format === "jpeg" || current.format === "png";
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

  const outputName = `gears-${index + 1}.${extension(file.name, current.format)}`;

  // 適用這個格式的工具。能處理目前找到的資訊的標成建議，排在前面
  const found = new Set(current.findings.map((f) => f.code));
  const shelf = [...fileTools.map((tool) => ({ tool, editor: false })), ...editorTools.map((tool) => ({ tool, editor: true }))]
    .filter(({ tool }) => tool.accepts(current.format))
    .map(({ tool, editor }) => ({ tool, editor, recommended: tool.resolves.some((code) => found.has(code)) }))
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
          <h3 id="editor-title">{tDynamic(`tool.${editing}`)}</h3>
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
      <div class={isImage ? "columns" : "columns single"}>
        {isImage ? <figure class="preview">{preview ? <img src={preview} alt="" /> : null}</figure> : null}

        <div class="panel">
          {isImage ? (
            <>
              <h3>{t("findings.title")}</h3>
              <Findings version={current} />
            </>
          ) : (
            <p class="note">{t(current.format === "age" ? "file.encrypted" : "file.unsupported")}</p>
          )}

          {isImage && file.versions[0]!.tool === null ? <QrInImage blob={current.blob} onOpenTool={onOpenTool} /> : null}

          <h3>{t("tools.title")}</h3>
          <ul class="shelf">
            {shelf.map(({ tool, editor, recommended }) => (
              <li key={tool.id}>
                <span class="shelf-name">
                  <strong>{tDynamic(`tool.${tool.id}`)}</strong>
                  {recommended ? <span class="badge">{t("tools.recommended")}</span> : null}
                  <small>{tDynamic(`tool.${tool.id}.desc`)}</small>
                </span>
                {current.tool === tool.id ? (
                  <span class="done">{t("tools.done")}</span>
                ) : (
                  <button
                    type="button"
                    class={recommended ? "primary" : ""}
                    disabled={busy}
                    aria-label={tDynamic(`tool.${tool.id}`)}
                    onClick={() => (editor ? setEditing(tool.id) : run(tool.id))}
                  >
                    {busy ? t("tools.busy") : t(editor ? "tools.open" : "tools.run")}
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
          {current.tool ? <Output version={current} name={outputName} /> : null}
        </div>
      </div>
      )}
    </section>
  );
}
