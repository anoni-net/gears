import { useMemo, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { generateKeyPair, keyFileText, keysAvailable } from "../tools/age/index.ts";
import { MARGIN, encodeQr, qrPath, qrPng, qrSvg } from "../tools/qrcode/index.ts";
import { CopyButton } from "./CopyButton.tsx";
import { track, trackFail } from "./analytics.ts";
import { type KeyPair, keygenSession } from "./keygen-session.ts";
import { saveBlob } from "./save.ts";
import type { CreateToolProps } from "./types.ts";

const KEY_FILE = "age-key.txt";

// 公鑰的 QR code 直接畫在這裡，不跳到 QR code 產生器，免得離開之後找不回私鑰
function RecipientQr({ recipient }: { recipient: string }) {
  const matrix = useMemo(() => encodeQr(recipient, "M"), [recipient]);
  const n = matrix.size + MARGIN * 2;
  return (
    <div class="key-qr">
      <svg class="qr-preview" role="img" aria-label={t("keygen.qrLabel")} viewBox={`0 0 ${n} ${n}`} shape-rendering="crispEdges">
        <rect width="100%" height="100%" fill="#fff" />
        <path d={qrPath(matrix)} fill="#000" />
      </svg>
      <div class="buttons">
        <button type="button" onClick={() => saveBlob(new Blob([qrPng(matrix) as Uint8Array<ArrayBuffer>], { type: "image/png" }), "age-public-key.png")}>
          {t("qr.downloadPng")}
        </button>
        <button type="button" onClick={() => saveBlob(new Blob([qrSvg(matrix)], { type: "image/svg+xml" }), "age-public-key.svg")}>
          {t("qr.downloadSvg")}
        </button>
      </div>
    </div>
  );
}

// 產生 age 的金鑰組。私鑰預設遮住，按了才顯示。金鑰檔可以下載，也可以放進暫存區，
// 接著用密語加密之後再存。金鑰組存在 keygen-session，離開這個工具再回來還在。
export function KeygenTool({ onCreate }: CreateToolProps) {
  const [pair, setPairState] = useState<KeyPair | null>(keygenSession.get);
  const [shown, setShown] = useState(false);
  const [qr, setQr] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const available = keysAvailable();

  const generate = async () => {
    setFailed(false);
    setBusy(true);
    try {
      const { identity, recipient } = await generateKeyPair();
      const next = { identity, recipient, file: keyFileText(identity, recipient, new Date()) };
      keygenSession.set(next);
      setPairState(next);
      setShown(false);
      setQr(false);
      track("tool-done", { tool: "age-keygen" });
    } catch {
      trackFail("age-keygen", "other");
      setFailed(true);
    } finally {
      setBusy(false);
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
        <button type="button" class={pair ? "" : "primary"} disabled={!available || busy} onClick={generate}>
          {busy ? t("keygen.busy") : pair ? t("keygen.again") : t("keygen.generate")}
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
              <button type="button" aria-expanded={qr} onClick={() => setQr((v) => !v)}>
                {qr ? t("keygen.hideQr") : t("keygen.toQr")}
              </button>
            </div>
            {qr ? <RecipientQr recipient={pair.recipient} /> : null}
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
              <CopyButton text={pair.identity} label={t("keygen.copyIdentity")} primary={false} onCopied={keygenSession.markSaved} />
            </div>
            <div class="buttons">
              <button
                type="button"
                class="primary"
                onClick={() => {
                  saveBlob(keyFile(), KEY_FILE);
                  keygenSession.markSaved();
                }}
              >
                {t("keygen.download")}
              </button>
              <button
                type="button"
                onClick={() => {
                  keygenSession.markSaved();
                  onCreate(keyFile());
                }}
              >
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
