import { t, tDynamic } from "../i18n/index.ts";
// 工作台自己的 LICENSE 沒有副檔名，用 ?url 輸出的檔案伺服器會當成二進位檔，所以直接放進頁面
import projectLicense from "../../LICENSE?raw";

// 授權與來源：工作台本身的授權，以及用到的第三方程式、模型與資料。授權全文是 licenses/ 底下的
// 純文字檔，用 ?url 匯入，跟著建置一起輸出（檔名帶雜湊），service worker 也會存起來，離線也能看。
// 新增 licenses/ 的檔案時，在 GROUPS 對應的那一組加一筆，三個語系加上 licenses.<id> 與 licenses.<id>.desc
const files = import.meta.glob<string>("../../licenses/*.txt", { query: "?url", import: "default", eager: true });
const fileUrl = (name: string) => files[`../../licenses/${name}.txt`];

// 依用途分組，每組一個 <h2>、每一項一個 <h3>，左欄的本頁目錄照這些小標題產生（src/ui/PageAside.tsx）。
// 分組照 AGENTS.md「第三方資料」：工作台本身、模型與執行模型的程式、讀寫檔案格式的程式、驗證簽章與憑證，
// 以及圖示與資料。2026-11-21 以前十三項排成一張清單，沒有小標題
interface Entry {
  id: string;
  url?: string;
  text?: string;
}

const GROUPS: { id: string; entries: Entry[] }[] = [
  { id: "app", entries: [{ id: "gears", text: projectLicense }] },
  {
    id: "models",
    entries: [
      { id: "transcribe", url: fileUrl("transcribe") },
      { id: "redact-detect", url: fileUrl("redact-detect") },
      { id: "verify-similar", url: fileUrl("verify-similar") },
    ],
  },
  {
    id: "files",
    entries: [
      { id: "pdfjs", url: fileUrl("pdfjs") },
      { id: "pdf-lib", url: fileUrl("pdf-lib") },
      { id: "libheif", url: fileUrl("libheif") },
      { id: "zxing", url: fileUrl("zxing") },
    ],
  },
  {
    id: "verify",
    entries: [
      { id: "openpgp", url: fileUrl("openpgp") },
      { id: "c2pa", url: fileUrl("c2pa") },
      { id: "pkijs", url: fileUrl("pkijs") },
    ],
  },
  {
    id: "data",
    entries: [
      { id: "material-design-icons", url: fileUrl("material-design-icons") },
      // 為什麼做 Gears 的同類工具圖示（public/peers/，scripts/make-peer-logos.mjs）
      { id: "peer-logos", url: fileUrl("peer-logos") },
      // 資料：授權寫在說明裡，沒有獨立的授權檔
      { id: "data-165" },
      { id: "data-diceware" },
      { id: "data-fleurs" },
    ],
  },
];

export function Licenses() {
  return (
    <section class="licenses" aria-labelledby="licenses-title">
      <h1 id="licenses-title" class="tool-title">
        {t("licenses.title")}
      </h1>
      <p class="hint">{t("licenses.intro")}</p>
      <div data-testid="licenses">
        {GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`licenses-group-${group.id}`}>
            <h2 id={`licenses-group-${group.id}`}>{tDynamic(`licenses.group.${group.id}`)}</h2>
            <ul>
              {group.entries.map(({ id, url, text }) => (
                <li key={id}>
                  <h3 id={`licenses-${id}`}>{tDynamic(`licenses.${id}`)}</h3>
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
        ))}
      </div>
    </section>
  );
}
