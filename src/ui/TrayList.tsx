import type { TrayFile } from "../core/tray.ts";
import { t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { useObjectUrl } from "./hooks.ts";

function Item({ file, selected }: { file: TrayFile; selected: boolean }) {
  const current = file.versions.at(-1)!;
  const url = useObjectUrl(current.format === "unknown" ? undefined : current.blob);
  const status =
    current.format === "unknown"
      ? t("tray.unsupported")
      : current.findings.length
        ? t("tray.found", { n: current.findings.length })
        : t("tray.clean");
  return (
    <li class={selected ? "item selected" : "item"}>
      <button type="button" class="pick" aria-current={selected} onClick={() => tray.select(file.id)}>
        {url ? <img src={url} alt="" /> : <span class="thumb" aria-hidden="true" />}
        <span class="meta">
          <span class="name">{file.name}</span>
          <span class={current.findings.length ? "status warn" : "status"}>
            {status}
            {file.versions.length > 1 ? ` · ${t("tray.versions", { n: file.versions.length })}` : ""}
          </span>
        </span>
      </button>
      <button type="button" class="remove" aria-label={`${t("tray.remove")}：${file.name}`} onClick={() => tray.remove(file.id)}>
        ×
      </button>
    </li>
  );
}

export function TrayList({ files, selected }: { files: TrayFile[]; selected: number | null }) {
  return (
    <section class="tray" aria-labelledby="tray-title">
      <h2 id="tray-title">{t("tray.title")}</h2>
      <ul>
        {files.map((file) => (
          <Item key={file.id} file={file} selected={file.id === selected} />
        ))}
      </ul>
    </section>
  );
}
