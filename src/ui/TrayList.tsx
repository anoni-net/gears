import { isPhoto } from "../core/bytes.ts";
import type { TrayFile } from "../core/tray.ts";
import { t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { useState } from "preact/hooks";
import { useObjectUrl } from "./hooks.ts";

interface ItemProps {
  file: TrayFile;
  selected: boolean;
  onSelect(id: number): void;
}

function Item({ file, selected, onSelect }: ItemProps) {
  const current = file.versions.at(-1)!;
  const isImage = isPhoto(current.format);
  const url = useObjectUrl(isImage ? current.blob : undefined);
  // Chrome、Firefox 不能顯示 HEIC，縮圖載入失敗時改成灰色方塊，不顯示破圖
  const [broken, setBroken] = useState(false);
  const status =
    current.format === "age"
      ? t("tray.encrypted")
      : !isImage
        ? t("tray.unsupported")
        : current.findings.length
        ? t("tray.found", { n: current.findings.length })
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
          <span class={!isImage ? "status muted" : current.findings.length ? "status warn" : "status"}>
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
  compact: boolean; // 在工具裡、暫存區又是空的，手機上收起來，不擋在工具前面
}

// 暫存區一直放在桌面上。空的時候就是拖放區。
export function TrayList({ files, selected, onSelect, onPick, compact }: Props) {
  return (
    <section class={compact ? "tray compact" : "tray"} aria-labelledby="tray-title">
      <h2 id="tray-title">{t("tray.title")}</h2>
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
