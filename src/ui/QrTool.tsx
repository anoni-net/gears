import { useMemo, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { type Ecc, MARGIN, QrTooLong, type WifiSecurity, encodeQr, qrPath, qrPng, qrSvg, wifiPayload } from "../tools/qrcode/index.ts";
import { saveBlob } from "./save.ts";
import { track } from "./analytics.ts";
import type { CreateToolProps } from "./types.ts";

const ECC: Ecc[] = ["L", "M", "Q", "H"];
const SECURITY: WifiSecurity[] = ["WPA", "WEP", "nopass"];

// 輸入的同時就畫出 QR code，不需要另外按「產生」。選項不多，都用攤開的選項按鈕，
// 不用下拉選單：手機上少點一下，選項也一眼看得到。手機上預覽排在內容欄位之後、
// 容錯度之前，輸入的時候就看得到結果。
export function QrTool({ preset, onCreate }: CreateToolProps) {
  const [mode, setMode] = useState<"text" | "wifi">(preset === "wifi" ? "wifi" : "text");
  // 其他工具帶入的內容（例如金鑰產生器的公鑰）直接放進文字欄位
  const [text, setText] = useState(preset && preset !== "wifi" ? preset : "");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const [hidden, setHidden] = useState(false);
  const [ecc, setEcc] = useState<Ecc>("M");

  const payload = mode === "text" ? text : ssid ? wifiPayload({ ssid, password, security, hidden }) : "";

  const result = useMemo(() => {
    if (!payload) return null;
    try {
      return { matrix: encodeQr(payload, ecc) };
    } catch (e) {
      if (e instanceof QrTooLong) return { error: t("qr.tooLong") };
      throw e;
    }
  }, [payload, ecc]);

  const matrix = result && "matrix" in result ? result.matrix : null;
  const name = mode === "wifi" ? "wifi-qrcode" : "qrcode";
  const png = () => new File([qrPng(matrix!) as Uint8Array<ArrayBuffer>], `${name}.png`, { type: "image/png" });

  return (
    <div class="qr">
      <div class="qr-form">
        <fieldset class="segmented">
          <legend>{t("qr.mode")}</legend>
          {(["text", "wifi"] as const).map((m) => (
            <label key={m}>
              <input type="radio" name="qr-mode" checked={mode === m} onChange={() => setMode(m)} />
              {t(m === "text" ? "qr.mode.text" : "qr.mode.wifi")}
            </label>
          ))}
        </fieldset>

        {mode === "text" ? (
          <label class="field">
            {t("qr.text")}
            <textarea
              rows={4}
              value={text}
              placeholder={t("qr.text.placeholder")}
              spellcheck={false}
              autocomplete="off"
              onInput={(e) => setText(e.currentTarget.value)}
            />
          </label>
        ) : (
          <>
            <label class="field">
              {t("qr.ssid")}
              <input type="text" value={ssid} spellcheck={false} autocomplete="off" onInput={(e) => setSsid(e.currentTarget.value)} />
            </label>
            <fieldset class="segmented">
              <legend>{t("qr.security")}</legend>
              {SECURITY.map((sec) => (
                <label key={sec}>
                  <input type="radio" name="qr-security" checked={security === sec} onChange={() => setSecurity(sec)} />
                  {t(`qr.security.${sec}`)}
                </label>
              ))}
            </fieldset>
            {security !== "nopass" ? (
              <label class="field">
                {t("qr.password")}
                <input type="text" value={password} spellcheck={false} autocomplete="off" onInput={(e) => setPassword(e.currentTarget.value)} />
              </label>
            ) : null}
            <label class="check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.currentTarget.checked)} />
              {t("qr.hidden")}
            </label>
          </>
        )}

      </div>

      <div class="qr-options">
        <fieldset class="segmented stacked">
          <legend>{t("qr.ecc")}</legend>
          {ECC.map((level) => (
            <label key={level}>
              <input type="radio" name="qr-ecc" checked={ecc === level} onChange={() => setEcc(level)} />
              {t(`qr.ecc.${level}`)}
            </label>
          ))}
        </fieldset>
        <p class="hint">{t("qr.plaintext")}</p>
      </div>

      <div class="qr-result">
        {matrix ? (
          <>
            <svg
              class="qr-preview"
              role="img"
              aria-label={t("qr.preview")}
              viewBox={`0 0 ${matrix.size + MARGIN * 2} ${matrix.size + MARGIN * 2}`}
              shape-rendering="crispEdges"
            >
              <rect width="100%" height="100%" fill="#fff" />
              <path d={qrPath(matrix)} fill="#000" />
            </svg>
            <div class="buttons">
              <button type="button" class="primary" onClick={() => onCreate(png())}>
                {t("qr.toTray")}
              </button>
              <button type="button" onClick={() => (track("tool-done", { tool: "qrcode" }), saveBlob(png(), `${name}.png`))}>
                {t("qr.downloadPng")}
              </button>
              <button type="button" onClick={() => (track("tool-done", { tool: "qrcode" }), saveBlob(new Blob([qrSvg(matrix)], { type: "image/svg+xml" }), `${name}.svg`))}>
                {t("qr.downloadSvg")}
              </button>
            </div>
            <p class="hint">{t("qr.svgNote")}</p>
          </>
        ) : result && "error" in result ? (
          <p class="error" role="alert">
            {result.error}
          </p>
        ) : (
          <p class="placeholder">{t("qr.empty")}</p>
        )}
      </div>
    </div>
  );
}
