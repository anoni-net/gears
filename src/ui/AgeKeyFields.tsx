import { useState } from "preact/hooks";
import { list, t } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { keysAvailable, parseRecipients } from "../tools/age/index.ts";
import { cryptoRandom, parseWordlist, pickWords } from "../tools/passphrase/index.ts";
import wordlistText from "../tools/passphrase/asian-diceware-7776.txt?raw";

// 加密檔案與加密文字共用：選擇用密語或對方的公鑰，填好之後回報能不能加密。

const MIN_PASSPHRASE = 8;

export type AgeKey = { passphrase: string } | { recipients: string[] };

export function useAgeKey() {
  const [mode, setMode] = useState<"passphrase" | "recipients">("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [recipients, setRecipients] = useState("");
  const parsed = parseRecipients(recipients);
  const available = keysAvailable();
  const ready =
    mode === "passphrase" ? passphrase.length >= MIN_PASSPHRASE : available && parsed.valid.length > 0 && parsed.invalid.length === 0;
  const key: AgeKey | null = !ready ? null : mode === "passphrase" ? { passphrase } : { recipients: parsed.valid };
  const generate = () => setPassphrase(pickWords(parseWordlist(wordlistText), 6, cryptoRandom).join(" "));

  const fields = (
    <>
      <fieldset class="segmented">
        <legend>{t("age.mode")}</legend>
        {(["passphrase", "recipients"] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="age-mode" checked={mode === m} onChange={() => setMode(m)} />
            {t(m === "passphrase" ? "age.mode.passphrase" : "age.mode.recipients")}
          </label>
        ))}
      </fieldset>

      {mode === "passphrase" ? (
        <>
          <label class="field">
            {t("age.passphrase")}
            <input type="text" value={passphrase} spellcheck={false} autocomplete="off" onInput={(e) => setPassphrase(e.currentTarget.value)} />
          </label>
          <div class="buttons">
            <button type="button" onClick={generate}>
              {t("age.generate")}
            </button>
          </div>
          {passphrase && passphrase.length < MIN_PASSPHRASE ? <p class="error">{t("age.tooShort", { n: MIN_PASSPHRASE })}</p> : null}
          <p class="hint">{t("age.passphraseNote")}</p>
        </>
      ) : (
        <>
          <label class="field">
            {t("age.recipients")}
            <textarea rows={4} value={recipients} spellcheck={false} autocomplete="off" placeholder="age1…" onInput={(e) => setRecipients(e.currentTarget.value)} />
          </label>
          {!available ? <p class="alert danger">{t("age.needsHttps")}</p> : null}
          {parsed.invalid.length ? <p class="error">{t("age.invalidRecipients", { list: list(parsed.invalid) })}</p> : null}
          <p class="hint">
            {t("age.recipientsNote")}{" "}
            <button type="button" class="link" onClick={() => navigate("age-keygen")}>
              {t("age.toKeygen")}
            </button>
          </p>
        </>
      )}
    </>
  );

  return { key, fields };
}
