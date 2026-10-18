import { useMemo, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import {
  type Ecc,
  MARGIN,
  type Payload,
  QrTooLong,
  type WifiSecurity,
  encodeQr,
  eventPayload,
  geoPayload,
  mailtoPayload,
  qrPath,
  qrPng,
  qrSvg,
  smsPayload,
  telPayload,
  vcardPayload,
  wifiPayload,
} from "../tools/qrcode/index.ts";
import { QR_MODES, type QrMode } from "../tools/qrcode/formats.ts";
import { saveBlob } from "./save.ts";
import { track } from "./analytics.ts";
import type { CreateToolProps } from "./types.ts";

const ECC: Ecc[] = ["L", "M", "Q", "H"];
const SECURITY: WifiSecurity[] = ["WPA", "WEP", "nopass"];

// 手機的相機掃到 Wi-Fi 之後的幾種會直接帶出動作（連線、存成聯絡人、加進行事曆、寫信、
// 撥號、傳簡訊），格式見 src/tools/qrcode/index.ts
const MODES = QR_MODES;
type Mode = QrMode;

// 下載的檔名，看得出是哪一種 QR code
const FILE_NAMES: Record<Mode, string> = {
  text: "qrcode",
  wifi: "wifi-qrcode",
  contact: "contact-qrcode",
  event: "event-qrcode",
  geo: "location-qrcode",
  email: "email-qrcode",
  phone: "phone-qrcode",
  sms: "sms-qrcode",
};

// 每種格式的欄位都放在同一份表單，切換格式時填過的內容留著
const EMPTY = {
  text: "",
  ssid: "",
  password: "",
  name: "",
  phone: "",
  email: "",
  org: "",
  url: "",
  to: "",
  subject: "",
  body: "",
  message: "",
  title: "",
  start: "",
  end: "",
  location: "",
  coords: "",
};
type Form = typeof EMPTY;

function payloadOf(mode: Mode, f: Form, security: WifiSecurity, hidden: boolean): Payload {
  switch (mode) {
    case "text":
      return f.text ? { text: f.text } : null;
    case "wifi":
      return f.ssid ? { text: wifiPayload({ ssid: f.ssid, password: f.password, security, hidden }) } : null;
    case "contact":
      return vcardPayload(f);
    case "event":
      return eventPayload({ title: f.title, start: f.start, end: f.end, location: f.location });
    case "geo":
      return geoPayload(f.coords);
    case "email":
      return mailtoPayload({ to: f.to, subject: f.subject, body: f.body });
    case "phone":
      return telPayload(f.phone);
    case "sms":
      return smsPayload({ number: f.phone, message: f.message });
  }
}

interface FieldProps {
  label: string;
  value: string;
  onInput(value: string): void;
  type?: "text" | "tel" | "email" | "url" | "datetime-local";
  inputMode?: "decimal";
  placeholder?: string;
  rows?: number;
}

function Field({ label, value, onInput, type = "text", inputMode, placeholder, rows }: FieldProps) {
  const common = { value, placeholder, spellcheck: false, autocomplete: "off", onInput: (e: Event) => onInput((e.currentTarget as HTMLInputElement).value) };
  return (
    <label class="field">
      {label}
      {/* preact 的型別依 type 拆成好幾組屬性，展開共用的屬性時要轉型 */}
      {rows ? <textarea rows={rows} {...common} /> : <input type={type as "text"} inputMode={inputMode} {...common} />}
    </label>
  );
}

// 輸入的同時就畫出 QR code，不需要另外按「產生」。選項不多，都用攤開的選項按鈕，
// 不用下拉選單：手機上少點一下，選項也一眼看得到。手機上預覽排在內容欄位之後、
// 容錯度之前，輸入的時候就看得到結果。
export function QrTool({ preset, onCreate }: CreateToolProps) {
  const [mode, setMode] = useState<Mode>(preset === "wifi" ? "wifi" : "text");
  // 其他工具帶入的內容（例如金鑰產生器的公鑰）直接放進文字欄位
  const [form, setForm] = useState<Form>({ ...EMPTY, text: preset && preset !== "wifi" ? preset : "" });
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const [hidden, setHidden] = useState(false);
  const [ecc, setEcc] = useState<Ecc>("M");

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const field = (key: keyof Form, label: string, extra: Partial<FieldProps> = {}) => <Field label={label} value={form[key]} onInput={set(key)} {...extra} />;

  const payload = payloadOf(mode, form, security, hidden);
  const text = payload && "text" in payload ? payload.text : "";

  const result = useMemo(() => {
    if (!text) return null;
    try {
      return { matrix: encodeQr(text, ecc) };
    } catch (e) {
      if (e instanceof QrTooLong) return { error: t("qr.tooLong") };
      throw e;
    }
  }, [text, ecc]);

  const error = payload && "error" in payload ? t(`qr.error.${payload.error}`) : result && "error" in result ? result.error : null;
  const matrix = result && "matrix" in result ? result.matrix : null;
  const name = FILE_NAMES[mode];
  const png = () => new File([qrPng(matrix!) as Uint8Array<ArrayBuffer>], `${name}.png`, { type: "image/png" });
  // 放進暫存區或下載才算完成。暫存區不記工具產生的檔案（src/state.ts 的 added），由這裡記
  const made = () => {
    track("tool-done", { tool: "qrcode" });
    track("qr-make", { format: mode });
  };

  return (
    <div class="qr">
      <div class="qr-form">
        <fieldset class="segmented">
          <legend>{t("qr.mode")}</legend>
          {MODES.map((m) => (
            <label key={m}>
              <input type="radio" name="qr-mode" checked={mode === m} onChange={() => setMode(m)} />
              {t(`qr.mode.${m}`)}
            </label>
          ))}
        </fieldset>

        {mode === "text" ? field("text", t("qr.text"), { rows: 4, placeholder: t("qr.text.placeholder") }) : null}

        {mode === "wifi" ? (
          <>
            {field("ssid", t("qr.ssid"))}
            <fieldset class="segmented">
              <legend>{t("qr.security")}</legend>
              {SECURITY.map((sec) => (
                <label key={sec}>
                  <input type="radio" name="qr-security" checked={security === sec} onChange={() => setSecurity(sec)} />
                  {t(`qr.security.${sec}`)}
                </label>
              ))}
            </fieldset>
            {security !== "nopass" ? field("password", t("qr.password")) : null}
            <label class="check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.currentTarget.checked)} />
              {t("qr.hidden")}
            </label>
          </>
        ) : null}

        {mode === "contact" ? (
          <>
            {field("name", t("qr.contact.name"))}
            {field("phone", t("qr.phone"), { type: "tel" })}
            {field("email", t("qr.email"), { type: "email" })}
            {field("org", t("qr.contact.org"))}
            {field("url", t("qr.contact.url"), { type: "url", placeholder: "https://" })}
            <p class="hint">{t("qr.contact.note")}</p>
          </>
        ) : null}

        {mode === "event" ? (
          <>
            {field("title", t("qr.event.title"))}
            {field("start", t("qr.event.start"), { type: "datetime-local" })}
            {field("end", t("qr.event.end"), { type: "datetime-local" })}
            {field("location", t("qr.event.location"))}
            <p class="hint">{t("qr.event.note")}</p>
          </>
        ) : null}

        {mode === "geo" ? (
          <>
            {field("coords", t("qr.geo"), { inputMode: "decimal", placeholder: t("qr.geo.placeholder") })}
            <p class="hint">{t("qr.geo.note")}</p>
          </>
        ) : null}

        {mode === "email" ? (
          <>
            {field("to", t("qr.email.to"), { type: "email" })}
            {field("subject", t("qr.email.subject"))}
            {field("body", t("qr.email.body"), { rows: 3 })}
          </>
        ) : null}

        {mode === "phone" ? field("phone", t("qr.phone"), { type: "tel" }) : null}

        {mode === "sms" ? (
          <>
            {field("phone", t("qr.phone"), { type: "tel" })}
            {field("message", t("qr.sms.message"), { rows: 3 })}
            <p class="hint">{t("qr.sms.note")}</p>
          </>
        ) : null}
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
        {error ? (
          <p class="error" role="alert">
            {error}
          </p>
        ) : matrix ? (
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
              <button type="button" class="primary" onClick={() => (made(), onCreate(png()))}>
                {t("qr.toTray")}
              </button>
              <button type="button" onClick={() => (made(), saveBlob(png(), `${name}.png`))}>
                {t("qr.downloadPng")}
              </button>
              <button type="button" onClick={() => (made(), saveBlob(new Blob([qrSvg(matrix)], { type: "image/svg+xml" }), `${name}.svg`))}>
                {t("qr.downloadSvg")}
              </button>
            </div>
            <p class="hint">{t("qr.svgNote")}</p>
            {mode !== "text" ? (
              <details class="qr-raw">
                <summary>{t("qr.raw")}</summary>
                <pre data-testid="qr-raw">{text}</pre>
              </details>
            ) : null}
          </>
        ) : (
          <p class="placeholder">{t("qr.empty")}</p>
        )}
      </div>
    </div>
  );
}
