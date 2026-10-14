import { useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { generateKeyPair, keyFileText, keysAvailable } from "../tools/age/index.ts";
import { CopyButton } from "./CopyButton.tsx";
import { saveBlob } from "./save.ts";
import type { CreateToolProps } from "./types.ts";

const KEY_FILE = "age-key.txt";

// 產生 age 的金鑰組。私鑰只在這個分頁裡，不存起來，預設遮住，按了才顯示。
// 金鑰檔可以下載，也可以放進暫存區，接著用密語加密之後再存。
export function KeygenTool({ onCreate, onOpenTool }: CreateToolProps) {
  const [pair, setPair] = useState<{ identity: string; recipient: string; file: string } | null>(null);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const available = keysAvailable();

  const generate = async () => {
    setFailed(false);
    try {
      const { identity, recipient } = await generateKeyPair();
      setPair({ identity, recipient, file: keyFileText(identity, recipient, new Date()) });
      setShown(false);
    } catch {
      setFailed(true);
    }
  };

  const keyFile = () => new File([pair!.file], KEY_FILE, { type: "text/plain" });

  return (
    <div class="keygen">
      <p class="hint">{t("keygen.intro")}</p>
      {!available ? (
        <p class="alert danger" role="alert">
          {t("age.needsHttps")}
        </p>
      ) : null}
      <div class="buttons">
        <button type="button" class={pair ? "" : "primary"} disabled={!available} onClick={generate}>
          {pair ? t("keygen.again") : t("keygen.generate")}
        </button>
      </div>
      {failed ? (
        <p class="error" role="alert">
          {t("keygen.failed")}
        </p>
      ) : null}
      {pair ? <p class="hint">{t("keygen.againNote")}</p> : null}

      {pair ? (
        <>
          <section aria-labelledby="recipient-title">
            <h3 id="recipient-title">{t("keygen.recipient")}</h3>
            <p class="hint">{t("keygen.recipientNote")}</p>
            <output class="secret key" data-testid="recipient">
              {pair.recipient}
            </output>
            <div class="buttons">
              <CopyButton text={pair.recipient} label={t("keygen.copyRecipient")} />
              <button type="button" onClick={() => onOpenTool("qrcode", pair.recipient)}>
                {t("keygen.toQr")}
              </button>
            </div>
          </section>

          <section aria-labelledby="identity-title">
            <h3 id="identity-title">{t("keygen.identity")}</h3>
            <p class="alert danger">{t("keygen.identityNote")}</p>
            <output class="secret key" data-testid="identity">
              {shown ? pair.identity : "AGE-SECRET-KEY-1" + "•".repeat(24)}
            </output>
            <div class="buttons">
              <button type="button" onClick={() => setShown((v) => !v)}>
                {shown ? t("keygen.hide") : t("keygen.show")}
              </button>
              <CopyButton text={pair.identity} label={t("keygen.copyIdentity")} primary={false} />
            </div>
            <div class="buttons">
              <button type="button" class="primary" onClick={() => saveBlob(keyFile(), KEY_FILE)}>
                {t("keygen.download")}
              </button>
              <button type="button" onClick={() => onCreate(keyFile())}>
                {t("keygen.toTray")}
              </button>
            </div>
            <p class="hint">{t("keygen.saveNote")}</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
