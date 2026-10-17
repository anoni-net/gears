import { useState } from "preact/hooks";
import type { TrayFile } from "../core/tray.ts";
import { writeZip } from "../core/zip.ts";
import { list, t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { fileTools } from "../tools/index.ts";
import { outputName } from "./output-name.ts";
import { track } from "./analytics.ts";
import { useWorking } from "./working.ts";

// 暫存區有兩個以上的檔案時，一次清除全部的中繼資料、一次下載成一個壓縮檔。
// 壓縮檔裡的檔名跟單檔下載一樣不沿用原檔名，時間由 src/core/zip.ts 統一成 1980-01-01。

// 壓縮檔在記憶體裡組成，太大的檔案不放進去，請讀者個別下載
const MAX_ZIP = 512 * 1024 * 1024;

const strip = fileTools.find((tool) => tool.id === "strip-metadata")!;

function save(blob: Blob, name: string) {
  track("save", { how: "zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function BatchActions({ files, busy }: { files: TrayFile[]; busy: boolean }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ done: number; failed: string[] } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [zipping, setZipping] = useState(false);
  useWorking(!!progress || zipping);
  if (files.length < 2) return null;

  const pending = files.filter((f) => tray.needs(strip, f.versions.at(-1)!)).length;
  const working = busy || zipping || progress !== null;

  const stripAll = async () => {
    setResult(null);
    const outcome = await tray.applyAll(strip, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setResult(outcome);
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      const entries = [];
      const left: string[] = [];
      let total = 0;
      for (const [i, file] of files.entries()) {
        const version = file.versions.at(-1)!;
        if (version.large || total + version.blob.size > MAX_ZIP) {
          left.push(file.name);
          continue;
        }
        total += version.blob.size;
        // 照片、影片與文件本身多半已經壓縮過，直接存放，不再壓縮一次
        entries.push({ name: outputName(file, i), data: new Uint8Array(await version.blob.arrayBuffer()), compress: false });
      }
      setSkipped(left);
      if (entries.length) save(new Blob([(await writeZip(entries)) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), "gears.zip");
    } finally {
      setZipping(false);
    }
  };

  return (
    <div class="batch" data-testid="batch">
      <button type="button" class={pending ? "primary" : ""} disabled={working || !pending} onClick={stripAll}>
        {pending ? t("batch.strip", { n: pending }) : t("batch.nothing")}
      </button>
      <button type="button" disabled={working} onClick={downloadAll}>
        {zipping ? t("batch.zipping") : t("batch.download")}
      </button>
      {progress ? (
        <p class="hint" role="status">
          {t("batch.progress", { done: progress.done, total: progress.total })}
        </p>
      ) : null}
      {result ? (
        <p class={result.failed.length ? "error" : "ok"} role="status">
          {t("batch.done", { n: result.done })}
          {result.failed.length ? t("batch.failed", { names: list(result.failed) }) : null}
        </p>
      ) : null}
      {skipped.length ? (
        <p class="hint" role="status">
          {t("batch.skipped", { names: list(skipped) })}
        </p>
      ) : null}
      <p class="hint">{t("batch.note")}</p>
    </div>
  );
}
