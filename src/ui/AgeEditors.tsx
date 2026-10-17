import { useState } from "preact/hooks";
import type { Report } from "../core/tool.ts";
import { t } from "../i18n/index.ts";
import { decrypt, encrypt, keysAvailable } from "../tools/age/index.ts";
import { useAgeKey } from "./AgeKeyFields.tsx";
import { trackFail } from "./analytics.ts";
import type { FileEditorProps } from "./types.ts";
import { useWorking } from "./working.ts";

// 加密任何檔案。用密語加密時，完成後用同一組密語解密一次，確認解得回來才交出去。
export function EncryptEditor({ blob, onDone, onCancel }: FileEditorProps) {
  const { key, fields } = useAgeKey();
  const [armored, setArmored] = useState(false);
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  useWorking(status === "working");

  const apply = async () => {
    if (!key) return;
    setStatus("working");
    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      const out = await encrypt(data, { ...key, armored });
      if ("passphrase" in key) {
        const back = await decrypt(out, key.passphrase);
        if (back.length !== data.length || back.some((b, i) => b !== data[i])) throw new Error("verify");
      }
      const notes: Report["notes"] = [
        "passphrase" in key ? { code: "age-passphrase" } : { code: "age-recipients", count: key.recipients.length },
      ];
      if (armored) notes.push({ code: "age-armor" });
      onDone(new Blob([out as Uint8Array<ArrayBuffer>]), { removed: [], kept: [], notes });
    } catch {
      trackFail("encrypt", "other");
      setStatus("failed");
    }
  };

  return (
    <div class="age">
      {fields}

      <label class="check">
        <input type="checkbox" checked={armored} onChange={(e) => setArmored(e.currentTarget.checked)} />
        {t("age.armor")}
      </label>

      <div class="buttons">
        <button type="button" class="primary" disabled={!key || status === "working"} onClick={apply}>
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
  useWorking(status === "working");
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
