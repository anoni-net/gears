import { MODELS, MODEL_IDS, type ModelId } from "./segments.ts";

// 逐字稿可以選的語言。Transformers.js 沒有實作 Whisper 的語言偵測，不指定語言時一律當成英文，
// 華語的錄音會直接翻成英文，所以由讀者選錄音裡說的語言。畫面先選語言，再列出這個語言能用的
// 模型（models.json 的 languages）。
//
// 粵語在 Transformers.js 沒有語言代碼，指定成粵語的 token 反而變差，等另外的模型。各語言的模型
// 調查記錄在社群的工作區
export const LANGUAGES = ["zh", "nan", "en", "ja", "ko", "vi", "th", "id", "ms", "tl"] as const;
export type Language = (typeof LANGUAGES)[number];

// 傳給 Whisper 的語言代碼。台語用 Breeze-ASR-26，它把台語轉成華語文字，語言代碼是 zh
export const whisperLanguage = (language: Language) => (language === "nan" ? "zh" : language);

// 半形標點換成全形只在輸出華語文字時做，日文與其他語言的標點不能動
export const isChinese = (language: Language) => language === "zh" || language === "nan";

// 這個語言能用的模型，依 models.json 的順序
export const modelsFor = (language: Language): ModelId[] => MODEL_IDS.filter((id) => (MODELS[id].languages as readonly string[]).includes(language));

// 換語言時預設選的模型：泰語、台語有專門訓練的模型，其他語言用 small。華語的 Breeze-ASR-25
// 比較準，但下載 1.2 GB 以上、在 CPU 上很慢，讓讀者自己選
const PREFERRED: Partial<Record<Language, ModelId>> = { th: "thai", nan: "breeze26" };

export function preferredModel(language: Language): ModelId {
  const usable = modelsFor(language);
  const wanted = PREFERRED[language] ?? "small";
  return usable.includes(wanted) ? wanted : usable[0]!;
}
