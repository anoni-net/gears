import { Fragment } from "preact";
import { list, t } from "../i18n/index.ts";
import { type InvoiceItem, type QrContent, classify } from "../tools/qr-read/index.ts";
import { CopyButton } from "./CopyButton.tsx";

const COINS = { bitcoin: "Bitcoin", monero: "Monero", zcash: "Zcash" } as const;

// 一行一個品項，境外電商的金額可能是外幣，不加單位
const itemLines = (items: InvoiceItem[], foreign = false) =>
  items.map((i) => t(foreign ? "qrread.invoice.itemForeign" : "qrread.invoice.item", { name: i.name, qty: i.qty, price: i.price })).join("\n");

// 認得的格式拆成欄位，讀者在手機帶出動作之前先看清楚：存進哪個聯絡人、撥給誰、
// 付款給哪個地址。空的欄位不列
function rows(c: QrContent): [string, string][] {
  const out: [string, string | string[]][] = (() => {
    switch (c.kind) {
      case "wifi":
        return [
          [t("qr.ssid"), c.ssid],
          [t("qr.password"), c.password],
          [t("qr.security"), c.security],
          [t("qr.hidden"), c.hidden ? t("qrread.yes") : ""],
        ];
      case "contact":
        return [
          [t("qr.contact.name"), c.name],
          [t("qr.contact.org"), c.org],
          [t("qrread.jobTitle"), c.title],
          [t("qr.phone"), c.phones],
          [t("qr.email"), c.emails],
          [t("qr.contact.url"), c.urls],
          [t("qrread.address"), c.address],
          [t("qrread.note"), c.note],
        ];
      case "event":
        return [
          [t("qr.event.title"), c.title],
          [t("qr.event.start"), c.start],
          [t("qrread.end"), c.end],
          [t("qr.event.location"), c.location],
          [t("qrread.description"), c.description],
        ];
      case "geo":
        return [
          [t("qrread.lat"), c.lat],
          [t("qrread.lng"), c.lng],
        ];
      case "email":
        return [
          [t("qr.email.to"), c.to],
          [t("qr.email.subject"), c.subject],
          [t("qr.email.body"), c.body],
        ];
      case "phone":
        return [[t("qr.phone"), c.number]];
      case "sms":
        return [
          [t("qr.phone"), c.number],
          [t("qr.sms.message"), c.message],
        ];
      case "otp":
        return [
          [t("qrread.issuer"), c.issuer],
          [t("qrread.account"), c.account],
        ];
      case "payment":
        return [
          [t("qrread.payTo"), c.address],
          [t("qrread.amount"), c.amount],
          [t("qrread.recipient"), c.label],
          [t("qrread.memo"), c.message],
        ];
      case "invoice":
        return [
          [t("qrread.invoice.number"), c.number],
          [t("qrread.invoice.date"), c.date],
          [t("qrread.invoice.random"), c.random],
          [t("qrread.invoice.total"), c.foreign ? c.total : t("qrread.invoice.amount", { n: c.total })],
          [t("qrread.invoice.seller"), c.seller],
          [t("qrread.invoice.buyer"), c.buyer],
          [t("qrread.invoice.items"), itemLines(c.items, c.foreign)],
          [t("qrread.invoice.itemCount"), c.itemTotal > c.items.length ? t("qrread.invoice.partial", { shown: c.items.length, total: c.itemTotal }) : ""],
        ];
      case "invoice-more":
        return [[t("qrread.invoice.items"), itemLines(c.items)]];
      default:
        return [];
    }
  })();
  return out.map(([k, v]): [string, string] => [k, Array.isArray(v) ? list(v) : v]).filter(([, v]) => v);
}

function kindLabel(c: QrContent): string | null {
  switch (c.kind) {
    case "wifi":
    case "contact":
    case "event":
    case "geo":
    case "email":
    case "phone":
    case "sms":
      return t(`qr.mode.${c.kind}`);
    case "otp":
      return t("qrread.kind.otp");
    case "payment":
      return COINS[c.coin];
    case "invoice":
      return t("qrread.kind.invoice");
    case "invoice-more":
      return t("qrread.kind.invoiceMore");
    default:
      return null;
  }
}

// 有風險的格式另外提醒：電話與簡訊可能是付費號碼，兩步驟驗證的金鑰不該外流，
// 付款的 QR code 可能被貼上假的
const NOTES: Partial<Record<QrContent["kind"], string>> = {
  url: "qrread.urlNote",
  phone: "qrread.phoneNote",
  sms: "qrread.smsNote",
  otp: "qrread.otpNote",
  payment: "qrread.paymentNote",
  invoice: "qrread.invoiceNote",
  "invoice-more": "qrread.invoiceNote",
};

// 讀出來的 QR code 內容。網址可以送去網址檢查，其他認得的格式拆成欄位顯示。
export function QrContentView({ text, onOpenTool }: { text: string; onOpenTool(id: string, preset?: string): void }) {
  const content = classify(text);
  const fields = rows(content);
  const kind = kindLabel(content);
  const note = NOTES[content.kind];
  const copy =
    content.kind === "wifi" && content.password
      ? { text: content.password, label: t("qrread.copyPassword") }
      : content.kind === "payment"
        ? { text: content.address, label: t("qrread.copyAddress") }
        : { text, label: undefined };
  return (
    <div class="qr-content">
      {kind ? (
        <dl class="qr-fields" data-testid="qr-fields">
          <dt>{t("qrread.kind")}</dt>
          <dd>{kind}</dd>
          {fields.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      <output class="secret" data-testid="qr-text">
        {text}
      </output>
      <div class="buttons">
        <CopyButton text={copy.text} label={copy.label} />
        {content.kind === "url" ? (
          <button type="button" onClick={() => onOpenTool("url-check", content.url)}>
            {t("qrread.checkUrl")}
          </button>
        ) : null}
        {text.includes("-----BEGIN AGE ENCRYPTED FILE-----") ? (
          <button type="button" onClick={() => onOpenTool("text-crypt", text)}>
            {t("qrread.decryptText")}
          </button>
        ) : null}
      </div>
      {note ? <p class={content.kind === "otp" || content.kind === "payment" ? "warn" : "hint"}>{t(note as "qrread.urlNote")}</p> : null}
    </div>
  );
}
