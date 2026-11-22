import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { callout } from "./callout.ts";
import type { FoundUrl } from "./url-ocr.ts";

// 從截圖讀出的網址列表：每一項是截圖上的裁切小圖、讀出的網址（可以直接修改）與「檢查這個網址」。
// 網址檢查的「從截圖讀出網址」與檔案畫面的「畫面上的網址」共用，按下檢查之後做什麼由呼叫的地方決定。
// 文字辨識會認錯 l 與 1、O 與 0 這類字，整理時不自動修正（src/tools/url-check/ocr.ts），所以列表上方
// 用「留意」的提示框請讀者對照截圖確認每個字

// 裁切小圖是事先畫好的 canvas，放進這個元素裡
function Crop({ canvas, label }: { canvas: HTMLCanvasElement; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
    ref.current?.replaceChildren(canvas);
  }, [canvas, label]);
  return <div class="url-ocr-crop" ref={ref} />;
}

function Item({ url, n, onCheck }: { url: FoundUrl; n: number; onCheck(url: string): void }) {
  const [value, setValue] = useState(url.text);
  return (
    <li>
      <Crop canvas={url.crop} label={t("urlocr.crop", { n })} />
      <label class="field">
        {t("urlocr.field", { n })}
        <input
          type="text"
          inputMode="url"
          value={value}
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          onInput={(e) => setValue(e.currentTarget.value)}
        />
      </label>
      <div class="buttons">
        <button type="button" disabled={!value.trim()} onClick={() => onCheck(value.trim())}>
          {t("urlocr.check")}
        </button>
      </div>
    </li>
  );
}

export function OcrUrlList({ urls, onCheck }: { urls: FoundUrl[]; onCheck(url: string): void }) {
  return (
    <div class="url-ocr-found" data-testid="url-ocr-found">
      <p class={callout("warn")}>
        <strong>{t("urlocr.caution.title")}</strong>
        {t("urlocr.caution")}
      </p>
      <ol class="url-ocr-list">
        {urls.map((url, i) => (
          <Item key={`${i}-${url.text}`} url={url} n={i + 1} onCheck={onCheck} />
        ))}
      </ol>
    </div>
  );
}
