import { useState } from "preact/hooks";
import type { Report } from "../core/tool.ts";
import { t } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { decrypt, encrypt, keysAvailable, parseRecipients } from "../tools/age/index.ts";
import { cryptoRandom, parseWordlist, pickWords } from "../tools/passphrase/index.ts";
import wordlistText from "../tools/passphrase/asian-diceware-7776.txt?raw";
import type { FileEditorProps } from "./types.ts";

const MIN_PASSPHRASE = 8;

// 加密任何檔案。用密語加密時，完成後用同一組密語解密一次，確認解得回來才交出去。
export function EncryptEditor({ blob, onDone, onCancel }: FileEditorProps) {
  const [mode, setMode] = useState<"passphrase" | "recipients">("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [recipients, setRecipients] = useState("");
  const [armored, setArmored] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");

  const parsed = parseRecipients(recipients);
  const available = keysAvailable();
  const ready =
    mode === "passphrase"
      ? passphrase.length >= MIN_PASSPHRASE
      : available && parsed.valid.length > 0 && parsed.invalid.length === 0;

  const generate = () => setPassphrase(pickWords(parseWordlist(wordlistText), 6, cryptoRandom).join(" "));

  const apply = async () => {
    setStatus("working");
    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      const out =
        mode === "passphrase"
          ? await encrypt(data, { passphrase, armored })
          : await encrypt(data, { recipients: parsed.valid, armored });
      if (mode === "passphrase") {
        const back = await decrypt(out, passphrase);
        if (back.length !== data.length || back.some((b, i) => b !== data[i])) throw new Error("verify");
      }
      const notes: Report["notes"] = [
        mode === "passphrase" ? { code: "age-passphrase" } : { code: "age-recipients", count: parsed.valid.length },
      ];
      if (armored) notes.push({ code: "age-armor" });
      onDone(new Blob([out as Uint8Array<ArrayBuffer>]), { removed: [], kept: [], notes });
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div class="age">
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
          {parsed.invalid.length ? <p class="error">{t("age.invalidRecipients", { list: parsed.invalid.join("、") })}</p> : null}
          <p class="hint">
            {t("age.recipientsNote")}{" "}
            <button type="button" class="link" onClick={() => navigate("age-keygen")}>
              {t("age.toKeygen")}
            </button>
          </p>
        </>
      )}

      <label class="check">
        <input type="checkbox" checked={armored} onChange={(e) => setArmored(e.currentTarget.checked)} />
        {t("age.armor")}
      </label>

      <div class="buttons">
        <button type="button" class="primary" disabled={!ready || status === "working"} onClick={apply}>
          {status === "working" ? t("age.working") : t("age.encrypt")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("redact.cancel")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("age.encryptFailed")}
        </p>
      ) : null}
      <p class="hint">{t("age.compat")}</p>
    </div>
  );
}

// 解開 .age 檔，密語或私鑰都可以，解開的內容當成新版本
export function DecryptEditor({ blob, onDone, onCancel }: FileEditorProps) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const usesIdentity = key.includes("AGE-SECRET-KEY-");
  const blocked = usesIdentity && !keysAvailable();

  const apply = async () => {
    setStatus("working");
    try {
      const out = await decrypt(new Uint8Array(await blob.arrayBuffer()), key);
      onDone(new Blob([out as Uint8Array<ArrayBuffer>]), { removed: [], kept: [], notes: [{ code: "age-decrypted" }] });
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div class="age">
      <label class="field">
        {t("age.key")}
        <textarea rows={3} value={key} spellcheck={false} autocomplete="off" onInput={(e) => setKey(e.currentTarget.value)} />
      </label>
      <p class="hint">{t("age.keyNote")}</p>
      {blocked ? <p class="alert danger">{t("age.needsHttps")}</p> : null}
      <div class="buttons">
        <button type="button" class="primary" disabled={!key.trim() || blocked || status === "working"} onClick={apply}>
          {status === "working" ? t("age.working") : t("age.decrypt")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("redact.cancel")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("age.decryptFailed")}
        </p>
      ) : null}
    </div>
  );
}
