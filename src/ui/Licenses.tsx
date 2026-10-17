import { t, tDynamic } from "../i18n/index.ts";
// 工作台自己的 LICENSE 沒有副檔名，用 ?url 輸出的檔案伺服器會當成二進位檔，所以直接放進頁面
import projectLicense from "../../LICENSE?raw";

// 授權與來源：工作台本身的授權，以及用到的第三方程式、模型與資料。授權全文是 licenses/ 底下的
// 純文字檔，用 ?url 匯入，跟著建置一起輸出（檔名帶雜湊），service worker 也會存起來，離線也能看。
// 新增 licenses/ 的檔案時，在 ENTRIES 加一筆，三個語系加上 licenses.<id> 與 licenses.<id>.desc
const files = import.meta.glob<string>("../../licenses/*.txt", { query: "?url", import: "default", eager: true });
const fileUrl = (name: string) => files[`../../licenses/${name}.txt`];

const ENTRIES: { id: string; url?: string; text?: string }[] = [
  { id: "gears", text: projectLicense },
  { id: "transcribe", url: fileUrl("transcribe") },
  { id: "redact-detect", url: fileUrl("redact-detect") },
  { id: "pdfjs", url: fileUrl("pdfjs") },
  { id: "pdf-lib", url: fileUrl("pdf-lib") },
  { id: "libheif", url: fileUrl("libheif") },
  { id: "openpgp", url: fileUrl("openpgp") },
  { id: "material-design-icons", url: fileUrl("material-design-icons") },
  // 資料：授權寫在說明裡，沒有獨立的授權檔
  { id: "data-165" },
  { id: "data-diceware" },
];

export function Licenses() {
  return (
    <section class="licenses" aria-labelledby="licenses-title">
      <h2 id="licenses-title" class="tool-title">
        {t("licenses.title")}
      </h2>
      <p class="hint">{t("licenses.intro")}</p>
      <ul data-testid="licenses">
        {ENTRIES.map(({ id, url, text }) => (
          <li key={id}>
            <strong>{tDynamic(`licenses.${id}`)}</strong>
            <p class="hint">{tDynamic(`licenses.${id}.desc`)}</p>
            {url ? (
              <a href={url} target="_blank" rel="noopener">
                {t("licenses.fullText")}
              </a>
            ) : null}
            {text ? (
              <details>
                <summary>{t("licenses.fullText")}</summary>
                <pre>{text}</pre>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
