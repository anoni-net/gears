import whisper from "../tools/transcribe/models.json" with { type: "json" };
import speaker from "../tools/transcribe/speaker-model.json" with { type: "json" };
import vad from "../tools/transcribe/vad-model.json" with { type: "json" };
import ppocr from "../tools/redact/ppocr-models.json" with { type: "json" };
import yunet from "../tools/redact/yunet-model.json" with { type: "json" };
import { PII_MODEL } from "../tools/redact/pii-model.ts";
import { PUNCT_MODEL } from "../tools/transcribe/punct.ts";
import { DINO_MODEL } from "../tools/verify/dino-model.ts";

// 設計原則頁（src/ui/AboutPage.tsx）的模型表：Gears 的工具用到的開源模型、授權與下載量。
// 數字一律從各模型的設定讀，不另外手寫：模型換版本或換大小時，這張表跟著變（AGENTS.md「設計原則頁」）。
// 只放工具用到的模型，裝置量測（實驗頁）的語言模型不列。執行模型的程式（onnxruntime、sherpa-onnx）不是模型，
// 也不列，頁面另外寫第一次要多下載的大小（src/core/storage.ts 的 RUNTIME_MB）。
//
// 新增模型：在 MODEL_CATALOG 加一筆，三個語系加上 about.use.<id>（用在哪個工具），tests/unit/i18n.spec.ts 會檢查。
// 逐字稿的模型照 models.json 自動列出，WHISPER_NAMES 少了名稱時型別檢查會失敗

// 授權全文在授權與來源頁的哪一項（src/ui/Licenses.tsx 的 licenses-<id>）
export type LicenseEntry = "redact-detect" | "transcribe" | "verify-similar";

export interface CatalogModel {
  id: string;
  name: string; // 模型的名稱，三個語系相同
  license: string;
  source: string; // 原始模型的來源頁
  bytes: number; // 畫面上寫的下載量
  licenses: LicenseEntry;
}

// 逐字稿的模型名稱（models.json 沒有這一欄，畫面上的 transcribe.model.<id> 帶著說明，不適合放進表格）
const WHISPER_NAMES: Record<keyof typeof whisper, string> = {
  small: "Whisper small",
  base: "Whisper base",
  turbo: "Whisper large-v3-turbo",
  thai: "distill-whisper-th-small",
  breeze25: "Breeze-ASR-25",
  breeze26: "Breeze-ASR-26",
  omni: "Omnilingual ASR CTC 300M",
};

// 逐字稿的大小照只用 CPU 的版本，跟逐字稿畫面在沒有顯示卡時寫的相同（顯示卡用的 4 位元版另有大小）
const whisperRows: CatalogModel[] = (Object.keys(whisper) as (keyof typeof whisper)[]).map((id) => ({
  id,
  name: WHISPER_NAMES[id],
  license: whisper[id].license,
  source: whisper[id].source,
  bytes: whisper[id].bytes,
  licenses: "transcribe",
}));

// 依工具排列：遮蔽的三個，接著逐字稿每次都會用到的語音偵測、辨識的模型、勾選才用的分辨說話者與轉完之後的標點建議，
// 最後是查證比對相近圖片的 DINOv2 small。個資辨識與標點模型的大小是經過 Cloudflare 的實際傳輸量，跟工具畫面寫的
// 「約 200 MB」、「約 148 MB」相同。DINOv2 還沒放上 assets.anoni.net，先用沒有壓縮的大小（dino-model.ts 的 transfer）
export const MODEL_CATALOG: readonly CatalogModel[] = [
  { id: "yunet", name: "YuNet", license: yunet.license, source: yunet.source, bytes: yunet.bytes, licenses: "redact-detect" },
  { id: "ppocr", name: "PP-OCRv5 mobile、PP-OCRv6 small", license: ppocr.license, source: ppocr.source, bytes: ppocr.det.bytes + ppocr.rec.bytes, licenses: "redact-detect" },
  { id: "pii", name: PII_MODEL.name, license: PII_MODEL.license, source: PII_MODEL.source, bytes: PII_MODEL.transfer, licenses: "redact-detect" },
  { id: "vad", name: `Silero VAD ${vad.version}`, license: vad.license, source: vad.source, bytes: vad.bytes, licenses: "transcribe" },
  ...whisperRows,
  { id: "speaker", name: "3D-Speaker CAM++", license: speaker.license, source: speaker.source, bytes: speaker.bytes, licenses: "transcribe" },
  { id: "punct", name: "multilingual-punctuation-truecase-small", license: PUNCT_MODEL.license, source: PUNCT_MODEL.source, bytes: PUNCT_MODEL.transfer, licenses: "transcribe" },
  { id: "dino", name: DINO_MODEL.name, license: DINO_MODEL.license, source: DINO_MODEL.source, bytes: DINO_MODEL.transfer, licenses: "verify-similar" },
];

// 第一次使用時的下載量範圍（代價與取捨那一段）：表格裡最小與最大的模型
export function catalogRange(models: readonly CatalogModel[] = MODEL_CATALOG): { min: CatalogModel; max: CatalogModel } {
  const sorted = [...models].sort((a, b) => a.bytes - b.bytes);
  return { min: sorted[0]!, max: sorted.at(-1)! };
}
