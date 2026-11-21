import { useEffect, useState } from "preact/hooks";
import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { Icon } from "./Icon.tsx";
import { StorageQuota } from "./StorageQuota.tsx";
import { PAGE_META, USER_PAGES } from "./tool-meta.ts";

// 工具以外的頁面（src/pages.ts 的 pageIds）在寬螢幕的左欄，佔著首頁暫存區的位置（2026-11-21 起）。
// 從桌面點進這些頁面時版面不跳動，原本留空的左欄也讓「檔案仍在記憶體裡」看得到。由上到下：
// - 暫存區摘要：檔案數與回到桌面，不放選檔案的按鈕，看起來不像可以操作的暫存區
// - 使用者區的頁面（USER_PAGES），以及授權與來源、隱私說明，標出目前的頁面
// - 本頁目錄：讀右欄有 id 的 h2、h3 自動產生，少於 3 個不顯示。已下載的模型改放這個網站的儲存空間
// 手機與窄螢幕不顯示（src/app.tsx 依 useMedia(WIDE) 決定），那裡本來就是單欄

// 本頁目錄的內容所在：右欄（src/app.tsx 的 .view）
export const CONTENT_ID = "page-content";

// 小標題少於這個數字的頁面不顯示目錄（建議與回饋、找不到的頁面）
const MIN_HEADINGS = 3;

const MORE_PAGES = ["licenses", "privacy"] as const;

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 讀右欄的小標題。只列有 id 的 h2、h3：協助測試每一項底下重複的「需要的裝置」、「測試步驟」沒有 id，不列進來，
// 新增頁面時想進目錄的小標題給一個固定的 id 就好，不必另外維護清單
function readHeadings(root: HTMLElement): Heading[] {
  return [...root.querySelectorAll<HTMLElement>("h2[id], h3[id]")].map((el) => ({
    id: el.id,
    text: el.textContent?.trim() ?? "",
    level: el.tagName === "H2" ? 2 : 3,
  }));
}

const same = (a: Heading[], b: Heading[]) => a.length === b.length && a.every((h, i) => h.id === b[i]!.id && h.text === b[i]!.text && h.level === b[i]!.level);

// 右欄的內容會晚一點出現或改變：裝置量測用到時才載入、範例頁依從哪個工具過來調整順序、換語系時文字跟著換。
// 換頁與換語系時重讀一次，另外用 MutationObserver 看右欄的元素有沒有增減，合併到下一個畫面才讀
function useHeadings(route: string): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const locale = getLocale();
  useEffect(() => {
    const root = document.getElementById(CONTENT_ID);
    if (!root) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = readHeadings(root);
      setHeadings((prev) => (same(prev, next) ? prev : next));
    };
    read();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(read);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [route, locale]);
  return headings;
}

// 讀到哪一段：最後一個捲過畫面上方四分之一的小標題。捲到底時是最後一個已經出現在畫面上的。
// 捲動事件合併到下一個畫面才計算，小標題最多二十幾個，每次只讀它們的位置
function useActive(headings: Heading[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!headings.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = innerHeight / 4;
      const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      let current: string | null = null;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= line || (atBottom && top < innerHeight)) current = h.id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule, { passive: true });
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [headings]);
  return [active, setActive];
}

// 捲到那一段，焦點移到小標題，讀螢幕軟體與鍵盤從那裡接著讀。網址換成 #id（replaceState，不多一筆上一頁），
// 讀者可以複製這一段的網址。不經過 navigate()：同一頁時它不做事，換頁時會捲回頂端。
// 系統設定減少動態效果時直接跳過去，不平滑捲動
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  history.replaceState(history.state, "", `#${id}`);
}

function PageToc({ route }: { route: string }) {
  const headings = useHeadings(route);
  const shown = headings.length >= MIN_HEADINGS ? headings : [];
  const [active, setActive] = useActive(shown);
  if (!shown.length) return null;
  return (
    <nav class="aside-toc" aria-labelledby="aside-toc-label" data-testid="aside-toc">
      <p id="aside-toc-label" class="aside-label">
        {t("aside.toc")}
      </p>
      <ul>
        {shown.map((h) => (
          <li key={h.id} class={h.level === 3 && shown.some((x) => x.level === 2) ? "sub" : undefined}>
            <a
              href={`#${h.id}`}
              aria-current={active === h.id ? "location" : undefined}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                jumpTo(h.id);
                setActive(h.id);
              }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface Props {
  route: string;
  files: number;
  onHome(): void;
}

export function PageAside({ route, files, onHome }: Props) {
  const link = (id: string, label: string) => (
    <a href={routeUrl(id)} aria-current={route === id ? "page" : undefined} onClick={(e) => onRouteClick(e, () => navigate(id))}>
      {label}
    </a>
  );
  return (
    <aside class="page-aside" aria-label={t("aside.label")} data-testid="page-aside">
      {/* 左欄在主內容之前，鍵盤與讀螢幕軟體可以直接跳過去。平常看不到，按 Tab 移到這裡時才出現 */}
      <a
        class="skip-link"
        href={`#${CONTENT_ID}`}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(CONTENT_ID)?.focus();
        }}
      >
        {t("aside.skip")}
      </a>

      {/* 暫存區的摘要：檔案仍在這個分頁的記憶體裡，回到桌面就看得到。外觀接續首頁暫存區的淡底，
          但沒有選檔案的按鈕，也不列出檔案，讀者不會以為可以在這裡操作 */}
      <div class={files ? "aside-tray has-files" : "aside-tray"} data-testid="aside-tray">
        {files ? (
          <>
            <p>{t("aside.tray.files", { n: files })}</p>
            <a
              class="aside-home"
              href={routeUrl("")}
              onClick={(e) =>
                onRouteClick(e, () => {
                  onHome();
                })
              }
            >
              <Icon name="home-outline" />
              {t("app.home")}
            </a>
          </>
        ) : (
          <p class="hint">{t("aside.tray.empty")}</p>
        )}
      </div>

      <nav class="aside-pages" aria-label={t("desk.group.user")} data-testid="aside-pages">
        <ul>
          {USER_PAGES.map((id) => (
            <li key={id}>
              <a href={routeUrl(id)} aria-current={route === id ? "page" : undefined} onClick={(e) => onRouteClick(e, () => navigate(id))}>
                <Icon name={PAGE_META[id].icon} />
                {tDynamic(PAGE_META[id].label ?? `${id}.title`)}
              </a>
            </li>
          ))}
        </ul>
        <ul class="aside-more">
          {MORE_PAGES.map((id) => (
            <li key={id}>{link(id, t(id === "licenses" ? "app.footer.licenses" : "app.footer.privacy"))}</li>
          ))}
        </ul>
      </nav>

      {route === "storage" ? <StorageQuota inAside /> : <PageToc route={route} />}
    </aside>
  );
}
