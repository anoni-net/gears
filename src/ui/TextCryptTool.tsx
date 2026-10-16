import { useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { decrypt, encrypt, keysAvailable } from "../tools/age/index.ts";
import { useAgeKey } from "./AgeKeyFields.tsx";
import { track } from "./analytics.ts";
import { CopyButton } from "./CopyButton.tsx";
import type { CreateToolProps } from "./types.ts";

// 加密或解開一段文字，例如要透過不加密的管道傳一組密碼、地址或聯絡方式。輸出是 age 的
// 文字格式，可以貼進任何訊息，對方用工作台或 age 命令列工具解開。
// 文字只放在這個畫面的記憶體裡，不存起來，也不放進暫存區。

// QR code 放得下的長度，超過就不提供轉成 QR code
const QR_LIMIT = 1500;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

function Encrypt({ onOpenTool }: CreateToolProps) {
  const { key, fields } = useAgeKey();
  const [plain, setPlain] = useState("");
  const [out, setOut] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");

  const run = async () => {
    if (!key || !plain) return;
    setStatus("working");
    try {
      const data = enc.encode(plain);
      const cipher = await encrypt(data, { ...key, armored: true });
      // 用密語加密時解開一次，確認解得回來
      if ("passphrase" in key && dec.decode(await decrypt(cipher, key.passphrase)) !== plain) throw new Error("verify");
      setOut(new TextDecoder().decode(cipher));
      setStatus("idle");
      track("tool-done", { tool: "text-crypt" });
    } catch {
      setStatus("failed");
    }
  };

  return (
    <>
      <label class="field">
        {t("textcrypt.plain")}
        <textarea rows={5} value={plain} spellcheck={false} autocomplete="off" onInput={(e) => (setPlain(e.currentTarget.value), setOut(""))} />
      </label>
      {fields}
      <div class="buttons">
        <button type="button" class="primary" disabled={!key || !plain || status === "working"} onClick={run}>
          {status === "working" ? t("age.working") : t("textcrypt.encrypt")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("age.encryptFailed")}
        </p>
      ) : null}
      {out ? (
        <section class="output" aria-labelledby="textcrypt-out">
          <h3 id="textcrypt-out">{t("textcrypt.cipher")}</h3>
          <textarea class="cipher" rows={8} readOnly value={out} data-testid="textcrypt-cipher" />
          <div class="buttons">
            <CopyButton text={out} />
            {out.length <= QR_LIMIT ? (
              <button type="button" onClick={() => onOpenTool("qrcode", out)}>
                {t("textcrypt.toQr")}
              </button>
            ) : null}
          </div>
          <p class="hint">{t("textcrypt.cipherNote")}</p>
        </section>
      ) : null}
    </>
  );
}

function Decrypt({ preset }: { preset?: string }) {
  const [cipher, setCipher] = useState(preset ?? "");
  const [secret, setSecret] = useState("");
  const [plain, setPlain] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "failed" | "binary">("idle");
  const blocked = secret.includes("AGE-SECRET-KEY-") && !keysAvailable();

  const run = async () => {
    setStatus("working");
    setPlain(null);
    try {
      const data = await decrypt(enc.encode(cipher.trim()), secret);
      try {
        setPlain(dec.decode(data));
        setStatus("idle");
        track("tool-done", { tool: "text-crypt" });
      } catch {
        // 解開的是檔案，不是文字，請讀者改用解密工具
        setStatus("binary");
      }
    } catch {
      setStatus("failed");
    }
  };

  return (
    <>
      <label class="field">
        {t("textcrypt.cipherIn")}
        <textarea rows={6} value={cipher} spellcheck={false} autocomplete="off" placeholder="-----BEGIN AGE ENCRYPTED FILE-----" onInput={(e) => setCipher(e.currentTarget.value)} />
      </label>
      <label class="field">
        {t("age.key")}
        <textarea rows={2} value={secret} spellcheck={false} autocomplete="off" onInput={(e) => setSecret(e.currentTarget.value)} />
      </label>
      <p class="hint">{t("age.keyNote")}</p>
      {blocked ? <p class="alert danger">{t("age.needsHttps")}</p> : null}
      <div class="buttons">
        <button type="button" class="primary" disabled={!cipher.trim() || !secret.trim() || blocked || status === "working"} onClick={run}>
          {status === "working" ? t("age.working") : t("textcrypt.decrypt")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("textcrypt.decryptFailed")}
        </p>
      ) : null}
      {status === "binary" ? (
        <p class="error" role="alert">
          {t("textcrypt.binary")}
        </p>
      ) : null}
      {plain !== null ? (
        <section class="output" aria-labelledby="textcrypt-plain">
          <h3 id="textcrypt-plain">{t("textcrypt.plainOut")}</h3>
          <textarea rows={6} readOnly value={plain} data-testid="textcrypt-plain" />
          <div class="buttons">
            <CopyButton text={plain} />
            <button type="button" onClick={() => setPlain(null)}>
              {t("textcrypt.hide")}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

export function TextCryptTool(props: CreateToolProps) {
  // 從別的工具帶進來的內容是加密過的文字（例如讀到的 QR code），直接打開解開的模式
  const [mode, setMode] = useState<"encrypt" | "decrypt">(props.preset?.includes("BEGIN AGE ENCRYPTED") ? "decrypt" : "encrypt");
  return (
    <div class="age">
      <fieldset class="segmented">
        <legend>{t("textcrypt.mode")}</legend>
        {(["encrypt", "decrypt"] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="textcrypt-mode" checked={mode === m} onChange={() => setMode(m)} />
            {t(m === "encrypt" ? "textcrypt.mode.encrypt" : "textcrypt.mode.decrypt")}
          </label>
        ))}
      </fieldset>
      {mode === "encrypt" ? <Encrypt {...props} /> : <Decrypt preset={props.preset?.includes("BEGIN AGE ENCRYPTED") ? props.preset : undefined} />}
      <p class="hint">{t("textcrypt.note")}</p>
    </div>
  );
}
