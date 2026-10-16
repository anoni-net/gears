// 逐字稿可以選的語言（Whisper 的語言代碼）。Transformers.js 沒有實作 Whisper 的語言偵測，
// 不指定語言時一律當成英文，華語的錄音會直接翻成英文，所以由讀者選錄音裡說的語言。
//
// 先列 large-v3-turbo 辨識得不錯、社群關注的亞洲語言。粵語在 Transformers.js 沒有語言代碼，
// 指定成粵語的 token 反而變差，等另外的模型。各語言的模型調查記錄在社群的工作區
export const LANGUAGES = ["zh", "en", "ja", "ko", "vi", "th", "id", "ms", "tl"] as const;
export type Language = (typeof LANGUAGES)[number];

// 簡體轉台灣正體、半形標點轉全形只在華語做，日文的漢字與其他語言的標點不能動
export const isChinese = (language: Language) => language === "zh";
