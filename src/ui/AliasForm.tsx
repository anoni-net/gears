import { useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { ALIAS_KINDS, ALIAS_LETTERS, type AliasKind, nextAlias } from "../tools/writing-style/index.ts";

// 讀者自己指定要換掉的字（人名、單位、地點），全文換成同一個代稱，例如〔人名 A〕。
// 寫作習慣檢查與逐字稿共用，換字本身由各自的畫面做（src/tools/writing-style/ 的 replaceTerm）。

// 代稱跟著介面的語系
export const aliasFormat = (kind: AliasKind) => (letter: string) => tDynamic(`alias.format.${kind}`, { letter });

// 所有可能的代稱，換上之後不再被標成寫作習慣，也不會被下一次指定的字拆壞
export const allAliases = () => ALIAS_KINDS.flatMap((kind) => ALIAS_LETTERS.map(aliasFormat(kind)));

export function AliasForm({
  id,
  text,
  hint,
  message,
  disabled,
  onReplace,
}: {
  id: string; // 表單的 data-testid，標題與選項的 id 也用它
  text: string; // 目前的全文，用來找下一個還沒用過的代稱
  hint: string;
  message?: string; // 換完之後的訊息，放在按鈕下面
  disabled?: boolean;
  onReplace: (word: string, alias: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<AliasKind>("person");
  const alias = nextAlias(text, aliasFormat(kind));
  const submit = (e: Event) => {
    e.preventDefault();
    const word = term.trim();
    if (!word || disabled) return;
    onReplace(word, alias);
    setTerm("");
  };
  return (
    <form class="style-alias" aria-labelledby={`${id}-title`} data-testid={id} onSubmit={submit}>
      <h3 id={`${id}-title`}>{t("alias.title")}</h3>
      <p class="hint">{hint}</p>
      <label class="field">
        {t("alias.term")}
        <input type="text" value={term} autocomplete="off" spellcheck={false} disabled={disabled} onInput={(e) => setTerm(e.currentTarget.value)} />
      </label>
      <fieldset class="segmented" disabled={disabled}>
        <legend>{t("alias.kind")}</legend>
        {ALIAS_KINDS.map((k) => (
          <label key={k}>
            <input type="radio" name={`${id}-kind`} checked={kind === k} onChange={() => setKind(k)} />
            {tDynamic(`alias.kind.${k}`)}
          </label>
        ))}
      </fieldset>
      <div class="buttons">
        <button type="submit" disabled={disabled || !term.trim()}>
          {t("alias.apply", { alias })}
        </button>
      </div>
      {message !== undefined ? (
        <p class="hint" role="status" data-testid={`${id}-status`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}

// 換完之後給讀者看的訊息：找不到、換了幾處，只有一個字時提醒其他詞裡的同一個字也會被換掉
export function aliasMessage(word: string, alias: string, count: number): string {
  if (!count) return t("alias.none", { term: word });
  const single = [...word].length === 1 ? t("alias.single") : "";
  return t("alias.done", { n: count, term: word, alias }) + single;
}
