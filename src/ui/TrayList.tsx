import { isPhoto } from "../core/bytes.ts";
import { CONTENT_FINDINGS } from "../core/tool.ts";
import type { TrayFile } from "../core/tray.ts";
import { list, t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { fileTools } from "../tools/index.ts";
import { useState } from "preact/hooks";
import { BatchActions } from "./BatchActions.tsx";
import { useObjectUrl } from "./hooks.ts";

interface ItemProps {
  file: TrayFile;
  selected: boolean;
  onSelect(id: number): void;
}

function Item({ file, selected, onSelect }: ItemProps) {
  const current = file.versions.at(-1)!;
  const isImage = isPhoto(current.format);
  const canInspect = fileTools.some((tool) => (current.large ? tool.acceptsLarge?.(current.format) : tool.accepts(current.format)));
  // 文件的註解與追蹤修訂是內容，清除之後仍然在，不算在找到的項目裡
  const found = current.findings.filter((f) => !CONTENT_FINDINGS.includes(f.code)).length;
  const url = useObjectUrl(isImage ? current.blob : undefined);
  // Chrome、Firefox 不能顯示 HEIC，縮圖載入失敗時改成灰色方塊，不顯示破圖
  const [broken, setBroken] = useState(false);
  const status =
    current.format === "age"
      ? t("tray.encrypted")
      : !canInspect
        ? t("tray.unsupported")
        : found
          ? t("tray.found", { n: found })
          : t("tray.clean");
  return (
    <li class={selected ? "item selected" : "item"}>
      <button type="button" class="pick" aria-current={selected} onClick={() => onSelect(file.id)}>
        {url && !broken ? (
          <img src={url} alt="" onError={() => setBroken(true)} />
        ) : (
          <span class="thumb" aria-hidden="true" />
        )}
        <span class="meta">
          <span class="name">{file.name}</span>
          <span class={!canInspect ? "status muted" : found ? "status warn" : "status"}>
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

interface Props {
  files: TrayFile[];
  selected: number | null;
  onSelect(id: number): void;
  onPick(): void;
  busy: boolean;
  failed: string[];
  compact: boolean; // 在工具裡、暫存區又是空的，手機上收起來，不擋在工具前面
}

// 暫存區一直放在桌面上。空的時候就是拖放區。
export function TrayList({ files, selected, onSelect, onPick, busy, failed, compact }: Props) {
  return (
    <section class={compact ? "tray compact" : "tray"} aria-labelledby="tray-title">
      <h2 id="tray-title">{t("tray.title")}</h2>
      {busy ? <p class="hint" role="status">{t("tray.reading")}</p> : null}
      {failed.length ? (
        <p class="error" role="alert">
          {t("tray.failed", { names: list(failed) })}
        </p>
      ) : null}
      {files.length ? (
        <>
          <ul>
            {files.map((file) => (
              <Item key={file.id} file={file} selected={file.id === selected} onSelect={onSelect} />
            ))}
          </ul>
          <button type="button" class="add" onClick={onPick}>
            {t("tray.add")}
          </button>
          <BatchActions files={files} busy={busy} />
        </>
      ) : (
        <div class="drop">
          <p>
            {t("tray.empty")}{" "}
            <button type="button" class="primary" onClick={onPick}>
              {t("tray.pick")}
            </button>
          </p>
          <p class="hint">{t("tray.hint")}</p>
        </div>
      )}
    </section>
  );
}
