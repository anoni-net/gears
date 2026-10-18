import { Fragment } from "preact";
import { getLocale, list, t } from "../i18n/index.ts";
import { type InvoiceItem, type QrContent, classify } from "../tools/qr-read/index.ts";
import { dayOfYear } from "../tools/qr-read/barcode.ts";
import { CopyButton } from "./CopyButton.tsx";

const COINS = { bitcoin: "Bitcoin", monero: "Monero", zcash: "Zcash" } as const;

// zxing 的條碼名稱換成常見的寫法
const FORMAT_LABELS: Record<string, string> = {
  QRCode: "QR code",
  MicroQRCode: "Micro QR code",
  RMQRCode: "rMQR code",
  PDF417: "PDF417",
  Aztec: "Aztec",
  DataMatrix: "Data Matrix",
  EAN13: "EAN-13",
  EAN8: "EAN-8",
  UPCA: "UPC-A",
  UPCE: "UPC-E",
  ISBN: "ISBN",
  Code128: "Code 128",
  Code39: "Code 39",
  Code93: "Code 93",
  ITF: "ITF",
  Codabar: "Codabar",
  DataBar: "GS1 DataBar",
};

// 國家與地區的名稱交給瀏覽器（Intl.DisplayNames），跟著介面的語系
const regionName = (code: string) => {
  try {
    return new Intl.DisplayNames([getLocale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const money = (n: string) => (n ? t("qrread.invoice.amount", { n }) : "");

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
      case "invoice-barcode":
        return [
          [t("qrread.invoice.number"), c.number],
          [t("qrread.invoice.period"), t("qrread.invoice.periodValue", { year: c.year, from: c.months[0], to: c.months[1] })],
          [t("qrread.invoice.random"), c.random],
        ];
      case "bridge":
        return [[t("qrread.bridge.list"), c.bridges.map((b) => `${b.transport} ${b.address}`).join("\n")]];
      case "proxy":
        return [
          [t("qrread.proxy.server"), c.server],
          [t("qrread.proxy.name"), c.name],
        ];
      case "invite":
        return [
          [t("qrread.invite.target"), t(`qrread.invite.${c.target}`)],
          [t("qr.phone"), c.phone],
        ];
      case "twpay":
        return [
          [t("qrread.twpay.type"), c.type ? t(`qrread.twpay.${c.type}`) : ""],
          [t("qrread.twpay.merchant"), c.merchant],
          [t("qrread.amount"), money(c.amount)],
          [t("qrread.twpay.bank"), c.bank],
          [t("qrread.twpay.account"), c.account],
          [t("qrread.memo"), c.memo],
          [t("qrread.twpay.expires"), c.expires],
          [t("qrread.twpay.service"), c.service],
        ];
      case "merchant-pay":
        return [
          [t("qrread.mpay.scheme"), c.scheme],
          [t("qrread.twpay.merchant"), c.merchant],
          [t("qrread.mpay.city"), c.city],
          [t("qrread.mpay.country"), c.country ? regionName(c.country) : ""],
          [t("qrread.amount"), c.amount ? `${c.amount} ${c.currency}` : ""],
          [t("qrread.mpay.crc"), c.crcOk ? "" : t("qrread.mpay.crcBad")],
        ];
      case "boarding-pass":
        return [
          [t("qrread.bp.name"), c.name],
          [t("qrread.bp.pnr"), [...new Set(c.legs.map((l) => l.pnr))]],
          [
            t("qrread.bp.flight"),
            c.legs
              .map((l) => {
                const { month, date } = dayOfYear(l.day);
                return t("qrread.bp.leg", { flight: `${l.carrier}${l.flight}`, from: l.from, to: l.to, month, date, seat: l.seat || "-" });
              })
              .join("\n"),
          ],
          [t("qrread.bp.extra"), c.extra ? t("qrread.bp.extraValue") : ""],
        ];
      case "product":
        return [
          [t("qrread.product.code"), c.code],
          [t("qrread.product.type"), c.type],
          [t("qrread.product.region"), c.region === "store" ? t("qrread.product.store") : c.region === "coupon" ? t("qrread.product.coupon") : c.region ? regionName(c.region) : ""],
        ];
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
    case "invoice-barcode":
      return t("qrread.kind.invoiceBarcode");
    case "bridge":
      return t("qrread.kind.bridge", { n: c.bridges.length });
    case "passkey":
      return t("qrread.kind.passkey");
    case "proxy":
      return t("qrread.kind.proxy", { protocol: c.protocol });
    case "invite":
      return t("qrread.kind.invite", { app: c.app });
    case "twpay":
      return t("qrread.kind.twpay");
    case "merchant-pay":
      return t("qrread.kind.merchantPay");
    case "boarding-pass":
      return t("qrread.kind.boardingPass");
    case "product":
      return t("qrread.kind.product");
    default:
      return null;
  }
}

// 有風險的格式另外提醒：電話與簡訊可能是付費號碼，兩步驟驗證的金鑰、bridge 的位址與代理的
// 密碼不該外流，付款的 QR code 可能被貼上假的，passkey 的 QR code 掃了會讓別人登入，
// 登機證的訂位代號拿來就能改行程。WARN 裡的用醒目的底色
const WARN = new Set<QrContent["kind"]>(["otp", "payment", "bridge", "passkey", "proxy", "twpay", "merchant-pay", "boarding-pass"]);

const NOTES: Partial<Record<QrContent["kind"], string>> = {
  url: "qrread.urlNote",
  phone: "qrread.phoneNote",
  sms: "qrread.smsNote",
  otp: "qrread.otpNote",
  payment: "qrread.paymentNote",
  invoice: "qrread.invoiceNote",
  "invoice-more": "qrread.invoiceNote",
  "invoice-barcode": "qrread.invoiceBarcodeNote",
  bridge: "qrread.bridgeNote",
  passkey: "qrread.passkeyNote",
  proxy: "qrread.proxyNote",
  invite: "qrread.inviteNote",
  twpay: "qrread.twpayNote",
  "merchant-pay": "qrread.paymentNote",
  "boarding-pass": "qrread.boardingPassNote",
  product: "qrread.productNote",
};

// 讀出來的 QR code 與條碼內容。網址可以送去網址檢查，其他認得的格式拆成欄位顯示。
// format 是條碼的種類（src/ui/qr-scan.ts），不是 QR code 時列在最前面
export function QrContentView({ text, format = "QRCode", onOpenTool }: { text: string; format?: string; onOpenTool(id: string, preset?: string): void }) {
  const content = classify(text, format);
  const fields = rows(content);
  const kind = kindLabel(content);
  const barcode = format === "QRCode" ? null : (FORMAT_LABELS[format] ?? format);
  const note = NOTES[content.kind];
  const copy =
    content.kind === "wifi" && content.password
      ? { text: content.password, label: t("qrread.copyPassword") }
      : content.kind === "payment"
        ? { text: content.address, label: t("qrread.copyAddress") }
        : content.kind === "bridge"
          ? { text: content.lines.join("\n"), label: t("qrread.copyBridges") }
          : { text, label: undefined };
  return (
    <div class="qr-content">
      {kind || barcode ? (
        <dl class="qr-fields" data-testid="qr-fields">
          {barcode ? (
            <>
              <dt>{t("qrread.format")}</dt>
              <dd>{barcode}</dd>
            </>
          ) : null}
          {kind ? (
            <>
              <dt>{t("qrread.kind")}</dt>
              <dd>{kind}</dd>
            </>
          ) : null}
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
        {content.kind === "url" || content.kind === "invite" ? (
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
      {note ? <p class={WARN.has(content.kind) ? "warn" : "hint"}>{t(note as "qrread.inviteNote", content.kind === "invite" ? { app: content.app } : undefined)}</p> : null}
    </div>
  );
}
