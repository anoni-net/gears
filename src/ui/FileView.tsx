import { useState } from "preact/hooks";
import { EXTENSION } from "../core/bytes.ts";
import { type Report, ToolError } from "../core/tool.ts";
import type { TrayFile, Version } from "../core/tray.ts";
import { t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { tools } from "../tools/index.ts";
import { useObjectUrl } from "./hooks.ts";

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
        <small>{t("report.bytes", { n: item.bytes.toLocaleString() })}</small>
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

export function FileView({ file, index, busy }: { file: TrayFile; index: number; busy: boolean }) {
  const current = file.versions.at(-1)!;
  const preview = useObjectUrl(current.format === "unknown" ? undefined : current.blob);
  const [error, setError] = useState<string>();

  if (current.format === "unknown") {
    return (
      <section class="file">
        <h2>{file.name}</h2>
        <p class="error">{t("file.unsupported")}</p>
      </section>
    );
  }

  const run = async (toolId: string) => {
    const tool = tools.find((x) => x.id === toolId)!;
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

  const outputName = `gears-${index + 1}.${EXTENSION[current.format]}`;

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

      <div class="columns">
        <figure class="preview">{preview ? <img src={preview} alt="" /> : null}</figure>

        <div class="panel">
          <h3>{t("findings.title")}</h3>
          <Findings version={current} />

          <div class="actions">
            {tools
              .filter((tool) => tool.accepts(current.format))
              .map((tool) =>
                current.tool === tool.id ? (
                  <p key={tool.id} class="done">
                    {t("tool.strip-metadata.done")}
                  </p>
                ) : (
                  <button key={tool.id} type="button" class="primary" disabled={busy} onClick={() => run(tool.id)}>
                    {busy ? t("tool.busy") : tDynamic(`tool.${tool.id}`)}
                  </button>
                ),
              )}
            {file.versions.length > 1 ? (
              <button type="button" onClick={() => tray.undo(file.id)} disabled={busy}>
                {t("file.undo")}
              </button>
            ) : null}
          </div>
          {error ? (
            <p class="error" role="alert">
              {error}
            </p>
          ) : null}

          {current.report ? <ReportView report={current.report} /> : null}
          {current.tool ? <Output version={current} name={outputName} /> : null}
        </div>
      </div>
    </section>
  );
}
