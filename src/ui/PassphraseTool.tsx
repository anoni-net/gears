import { useMemo, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import {
  CHARSETS,
  type CharsetName,
  cryptoRandom,
  entropyBits,
  makePassword,
  parseWordlist,
  passwordPoolSize,
  pickWords,
} from "../tools/passphrase/index.ts";
import wordlistText from "../tools/passphrase/asian-diceware-7776.txt?raw";
import { CopyButton } from "./CopyButton.tsx";
import type { CreateToolProps } from "./types.ts";

const WORDS = parseWordlist(wordlistText);
const WORD_COUNTS = [5, 6, 7, 8];
const SEPARATORS = [" ", "-", "."];
const LENGTHS = [12, 16, 20, 24, 32];
const SET_NAMES = Object.keys(CHARSETS) as CharsetName[];

// 產生的內容只顯示在畫面上，不存起來，也不放進暫存區。
export function PassphraseTool(_: CreateToolProps) {
  const [mode, setMode] = useState<"words" | "chars">("words");
  const [count, setCount] = useState(6);
  const [separator, setSeparator] = useState(" ");
  const [length, setLength] = useState(20);
  const [sets, setSets] = useState<CharsetName[]>([...SET_NAMES]);
  const [seed, setSeed] = useState(0); // 換一個值就重新產生

  const value = useMemo(() => {
    if (mode === "words") return pickWords(WORDS, count, cryptoRandom).join(separator);
    return sets.length ? makePassword(sets, length, cryptoRandom) : "";
  }, [mode, count, separator, length, sets, seed]);

  const bits = Math.round(mode === "words" ? entropyBits(WORDS.length, count) : entropyBits(passwordPoolSize(sets), length));

  const toggle = (name: CharsetName) =>
    setSets((current) => (current.includes(name) ? current.filter((s) => s !== name) : SET_NAMES.filter((s) => s === name || current.includes(s))));

  return (
    <div class="passphrase">
      <fieldset class="segmented">
        <legend>{t("pw.mode")}</legend>
        {(["words", "chars"] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="pw-mode" checked={mode === m} onChange={() => setMode(m)} />
            {t(m === "words" ? "pw.mode.words" : "pw.mode.chars")}
          </label>
        ))}
      </fieldset>

      <output class="secret" aria-live="polite" data-testid="secret">
        {value || t("pw.noCharset")}
      </output>
      <div class="buttons">
        <CopyButton text={value} />
        <button type="button" onClick={() => setSeed((n) => n + 1)}>
          {t("pw.again")}
        </button>
      </div>
      <p class="hint">{t("pw.strength", { bits })}</p>

      {mode === "words" ? (
        <>
          <fieldset class="segmented">
            <legend>{t("pw.count")}</legend>
            {WORD_COUNTS.map((n) => (
              <label key={n}>
                <input type="radio" name="pw-count" checked={count === n} onChange={() => setCount(n)} />
                {t("pw.words", { n })}
              </label>
            ))}
          </fieldset>
          <fieldset class="segmented">
            <legend>{t("pw.separator")}</legend>
            {SEPARATORS.map((sep) => (
              <label key={sep}>
                <input type="radio" name="pw-sep" checked={separator === sep} onChange={() => setSeparator(sep)} />
                {sep === " " ? t("pw.separator.space") : <code>{sep}</code>}
              </label>
            ))}
          </fieldset>
          <p class="hint">{t("pw.wordsNote")}</p>
        </>
      ) : (
        <>
          <fieldset class="segmented">
            <legend>{t("pw.length")}</legend>
            {LENGTHS.map((n) => (
              <label key={n}>
                <input type="radio" name="pw-length" checked={length === n} onChange={() => setLength(n)} />
                {t("pw.chars", { n })}
              </label>
            ))}
          </fieldset>
          <fieldset class="segmented">
            <legend>{t("pw.charsets")}</legend>
            {SET_NAMES.map((name) => (
              <label key={name}>
                <input type="checkbox" checked={sets.includes(name)} onChange={() => toggle(name)} />
                {t(`pw.set.${name}`)}
              </label>
            ))}
          </fieldset>
        </>
      )}

      <p class="hint">{t("pw.privacy")}</p>
      <p class="hint">
        {t("pw.credit")} <a href="https://github.com/anoni-net/asian-diceware">asian-diceware</a>（CC BY 4.0）
      </p>
    </div>
  );
}
