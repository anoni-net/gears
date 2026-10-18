import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { t, tDynamic } from "../i18n/index.ts";
import qrSamples from "../tools/qr-read/samples.json" with { type: "json" };
import { IconCircle } from "./Icon.tsx";
import { FILE_SAMPLES, type FileSample } from "./samples.ts";
import { PAGE_META, TOOL_META } from "./tool-meta.ts";

// 有範例的工具，工具畫面放一行連到這裡的連結（SampleLink）
export const SAMPLE_TOOLS: readonly string[] = [...FILE_SAMPLES.map((s) => s.tool), "qr-read"];

export const qrSampleUrl = (id: string) => `${import.meta.env.BASE_URL}samples/qr/${id}.png`;
const QR_GROUPS = ["share", "check", "connect", "everyday"] as const;

interface Props {
  focus?: string; // 從工具的連結過來時，那個工具的範例排在最前面
  onOpenFile(sample: FileSample): Promise<void>;
  onOpenQr(id: string): void;
}

// 範例：手邊沒有檔案時試用，對外展示時也用得到。內容都是假的，檔案按下按鈕時才產生
// （src/ui/samples.ts），QR code 與條碼的圖片在建置前產生（scripts/make-qr-samples.mjs）。
// 放進暫存區的範例檔標成 sample，畫面上標出來，也不記使用統計
export function SamplesPage({ focus, onOpenFile, onOpenQr }: Props) {
  const [opening, setOpening] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const open = async (sample: FileSample) => {
    setOpening(sample.id);
    setFailed(false);
    try {
      await onOpenFile(sample);
    } catch {
      setFailed(true);
      setOpening(null);
    }
  };

  // 從工具的連結過來時，那個工具的範例排在最前面，不必往下捲
  const sections: [string, JSX.Element][] = [
    ...FILE_SAMPLES.map((sample): [string, JSX.Element] => [
      sample.tool,
      <section key={sample.id} id={`samples-${sample.tool}`} class="sample-tool" aria-labelledby={`samples-${sample.id}-title`}>
        <h3 id={`samples-${sample.id}-title`}>
          <IconCircle name={TOOL_META[sample.tool]!.icon} cat={TOOL_META[sample.tool]!.cat} />
          {tDynamic(`tool.${sample.tool}`)}
        </h3>
        <div class="sample-file">
          <strong>{tDynamic(`samples.${sample.id}.title`)}</strong>
          <p class="hint">{tDynamic(`samples.${sample.id}.desc`)}</p>
          <button type="button" onClick={() => void open(sample)} disabled={opening !== null} data-sample={sample.id}>
            {opening === sample.id ? t("app.loading") : t("samples.open", { tool: tDynamic(`tool.${sample.tool}`) })}
          </button>
        </div>
      </section>,
    ]),
    [
      "qr-read",
      <section key="qr-read" id="samples-qr-read" class="sample-tool qr-samples" aria-labelledby="samples-qr-title">
        <h3 id="samples-qr-title">
          <IconCircle name={TOOL_META["qr-read"]!.icon} cat={TOOL_META["qr-read"]!.cat} />
          {t("tool.qr-read")}
        </h3>
        <p class="hint">{t("samples.qr.hint")}</p>
        {QR_GROUPS.map((group) => (
          <section key={group} aria-labelledby={`qr-samples-${group}`}>
            <h4 id={`qr-samples-${group}`}>{tDynamic(`qrread.samples.${group}`)}</h4>
            <ul>
              {qrSamples
                .filter((s) => s.group === group)
                .map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onOpenQr(s.id)} data-sample={s.id}>
                      <img src={qrSampleUrl(s.id)} alt="" loading="lazy" />
                      <span>{tDynamic(`qrread.sample.${s.id}`)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </section>,
    ],
  ];
  if (focus) sections.sort(([a], [b]) => Number(b === focus) - Number(a === focus));

  return (
    <section class="samples" aria-labelledby="samples-title">
      <h2 id="samples-title" class="tool-title">
        <IconCircle name={PAGE_META.samples.icon} cat={PAGE_META.samples.cat} />
        {t("samples.title")}
      </h2>
      <p>{t("samples.intro")}</p>
      {failed ? (
        <p class="error" role="alert">
          {t("samples.failed")}
        </p>
      ) : null}

      {sections.map(([, section]) => section)}
    </section>
  );
}

// 工具畫面的「沒有檔案？用範例試試」
export function SampleLink({ tool, onOpen }: { tool: string; onOpen(tool: string): void }) {
  if (!SAMPLE_TOOLS.includes(tool)) return null;
  return (
    <p class="hint">
      <button type="button" class="link" onClick={() => onOpen(tool)} data-testid="sample-link">
        {t("samples.link")}
      </button>
    </p>
  );
}
