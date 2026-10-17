import { useMemo, useState } from "preact/hooks";
import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { FIXABLE, HABIT_CODES, type Habit, type HabitCode, applyHabits, findHabits, fixHabits, replacementOf } from "../tools/writing-style/index.ts";
import { useDoneOnce } from "./analytics.ts";
import { CopyButton } from "./CopyButton.tsx";
import type { CreateToolProps } from "./types.ts";

// 寫作習慣檢查：貼上要匿名交出去的文字，標出表情符號、語助詞、中英夾雜、地區用語這類
// 會讓人認出作者的習慣。標點與符號可以一鍵修正。有建議寫法的（視頻改成影片、刪掉「啦」）
// 讀者逐項按下才套用，每一處修改都看得見，可以一步一步復原。
// 規則在 src/tools/writing-style/，只在這個分頁裡處理，不送出也不存下來。

const isFixable = (h: Habit) => FIXABLE.includes(h.code) && h.fix !== undefined;

// 把文字切成一般的字與標出來的習慣，習慣之間不會重疊
function Marked({ text, habits }: { text: string; habits: Habit[] }) {
  const parts = [];
  let at = 0;
  for (const [i, h] of habits.entries()) {
    if (h.start > at) parts.push(text.slice(at, h.start));
    const shown = text.slice(h.start, h.end);
    parts.push(
      <mark key={i} class={`habit ${h.code === "pii" ? "pii" : isFixable(h) ? "fixable" : ""}`} title={tDynamic(`style.code.${h.code}`)}>
        {/* 空白與換行也標得出來 */}
        {shown.trim() ? shown : "␣"}
      </mark>,
    );
    at = h.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <div class="style-preview">{parts}</div>;
}

function suggestion(h: Habit): string {
  if (h.code === "pii") return tDynamic(`style.pii.${h.pii}`);
  if (isFixable(h)) {
    if (!h.fix) return t("style.willRemove");
    // 引號的修正本身就是「」，不再多包一層
    const to = h.fix === "\n\n" ? t("style.blankLine") : /^「.*」$/s.test(h.fix) ? h.fix.slice(1, -1) : h.fix;
    return t("style.willFix", { to });
  }
  if (h.suggest === "") return t("style.remove");
  if (h.suggest) return t("style.suggest", { to: h.suggest });
  return "";
}

// 需要讀者自己改、而且有建議寫法的，可以逐項套用
const applicable = (h: Habit) => !FIXABLE.includes(h.code) && replacementOf(h) !== undefined;

// 同一類習慣的不同寫法，最多列八個。同樣的寫法出現好幾次時一起套用
function Examples({ habits, onApply }: { habits: Habit[]; onApply: (chosen: Habit[]) => void }) {
  const seen = new Map<string, Habit[]>();
  for (const h of habits) {
    const key = h.text.trim();
    if (key) seen.set(key, [...(seen.get(key) ?? []), h]);
  }
  const items = [...seen.entries()].slice(0, 8);
  return (
    <ul class="style-examples">
      {items.map(([text, same]) => {
        const h = same[0]!;
        const to = replacementOf(h);
        const count = same.length > 1 ? t("style.count", { n: same.length }) : "";
        return (
          <li key={text}>
            <code>{text}</code>
            {applicable(h) ? (
              <button
                type="button"
                class="small"
                aria-label={to ? t("style.applyLabel", { from: text, to: to }) + count : t("style.removeLabel", { from: text }) + count}
                onClick={() => onApply(same)}
              >
                {(to ? t("style.applyTo", { to }) : t("style.applyRemove")) + count}
              </button>
            ) : suggestion(h) ? (
              <span class="hint">{suggestion(h)}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Groups({ groups, id, onApply }: { groups: [HabitCode, Habit[]][]; id: string; onApply: (chosen: Habit[]) => void }) {
  return (
    <ul class="style-groups" data-testid={id}>
      {groups.map(([code, list]) => {
        const all = list.filter(applicable);
        return (
          <li key={code}>
            <strong>
              <span>{tDynamic(`style.code.${code}`)}</span>
              <span class="badge">{list.length}</span>
            </strong>
            <p class="hint">{tDynamic(`style.code.${code}.desc`)}</p>
            <Examples habits={list} onApply={onApply} />
            {all.length > 1 && new Set(all.map((h) => h.text.trim())).size > 1 ? (
              <button type="button" class="small" onClick={() => onApply(all)}>
                {t("style.applyAll", { n: all.length })}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function WritingStyleTool(_: CreateToolProps) {
  const [text, setText] = useState("");
  // 每次修正或套用前的文字，復原時一步一步退回。讀者自己打字之後清空
  const [history, setHistory] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const habits = useMemo(() => findHabits(text), [text]);
  const fixable = habits.filter(isFixable).length;
  const groups = HABIT_CODES.map((code) => [code, habits.filter((h) => h.code === code)] as [HabitCode, Habit[]]).filter(([, list]) => list.length);
  // 需要讀者自己改的放前面，可以直接修正的放後面
  const manual = groups.filter(([code]) => !FIXABLE.includes(code));
  const auto = groups.filter(([code]) => FIXABLE.includes(code));
  useDoneOnce("writing-style", text.trim().length >= 20);

  const change = (next: string, message: string) => {
    setHistory([...history, text]);
    setText(next);
    setNote(message);
  };
  const fix = () => change(fixHabits(text), t("style.fixed", { n: fixable }));
  const apply = (chosen: Habit[]) => change(applyHabits(text, chosen), t("style.applied", { n: chosen.length }));
  const undo = () => {
    if (!history.length) return;
    setText(history.at(-1)!);
    setHistory(history.slice(0, -1));
    setNote(t("style.undone"));
  };

  return (
    <div class="writing-style">
      <label class="field">
        {t("style.input")}
        <textarea
          rows={8}
          value={text}
          autocomplete="off"
          onInput={(e) => {
            setText(e.currentTarget.value);
            setHistory([]);
            setNote("");
          }}
        />
      </label>
      <p class="hint">{t("style.privacy")}</p>

      {text.trim() ? (
        <>
          <p role="status" data-testid="style-summary">
            {/* 英文的句子之間空一格，中文不空 */}
            {note ? `${note}${getLocale() === "en" ? " " : ""}` : ""}
            {!habits.length ? t("style.none") : fixable ? t("style.found", { n: habits.length, fixable }) : t("style.foundManual", { n: habits.length })}
          </p>
          <div class="buttons">
            <button type="button" class="primary" disabled={!fixable} onClick={fix}>
              {t("style.fix")}
            </button>
            {history.length ? (
              <button type="button" onClick={undo}>
                {t("style.undo")}
              </button>
            ) : null}
            <CopyButton text={text} label={t("style.copy")} primary={false} />
          </div>

          {habits.length ? (
            <>
              <section aria-labelledby="style-preview-title">
                <h3 id="style-preview-title">{t("style.preview")}</h3>
                <p class="hint">{t("style.legend")}</p>
                <Marked text={text} habits={habits} />
              </section>
              {manual.length ? (
                <section aria-labelledby="style-manual-title">
                  <h3 id="style-manual-title">{t("style.manual")}</h3>
                  <Groups groups={manual} id="style-manual" onApply={apply} />
                </section>
              ) : null}
              {auto.length ? (
                <section aria-labelledby="style-auto-title">
                  <h3 id="style-auto-title">{t("style.auto")}</h3>
                  <Groups groups={auto} id="style-auto" onApply={apply} />
                </section>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      <p class="alert">{t("style.limit")}</p>
    </div>
  );
}
