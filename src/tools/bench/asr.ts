import sample from "./asr-sample.json" with { type: "json" };
import { cer } from "./ocr.ts";

// 裝置量測的逐字稿（src/ui/AsrBench.tsx，#157）：一段固定的華語錄音與正確答案。錄音取自 Google 的
// FLEURS 資料集（CC BY 4.0，華語測試集的三句朗讀，男女聲各有），句子之間補上 0.6 秒的靜音，
// 存成 16 kHz、單聲道、16 位元的 WAV，不必經過瀏覽器的解碼器，各裝置讀到的樣本完全相同。
// 挑的句子不含數字與英文，數字寫成國字或阿拉伯數字都算對，混進來會讓字錯率反映的是寫法。
// 正確答案用逐字稿同一套 OpenCC（cn → twp）轉成正體，跟逐字稿的輸出比得起來

export interface AsrSample {
  file: string; // 相對於網站的根目錄
  sha256: string;
  bytes: number;
  seconds: number;
  language: "zh";
  source: { dataset: string; split: string; config: string; ids: number[]; license: string };
  lines: string[];
}

export const ASR_SAMPLE = sample as AsrSample;

// 只比對文字與數字，標點與空白拿掉：Whisper 的標點時有時無，算進去的話字錯率反映的是標點。
// 英文字母一律小寫。編輯距離的算法跟文字辨識相同（ocr.ts 的 cer）
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export const asrCer = (reference: string, hypothesis: string) => cer(normalize(reference), normalize(hypothesis));
