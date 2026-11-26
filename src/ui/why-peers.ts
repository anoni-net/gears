import type { GroupId } from "./tool-meta.ts";

// 「為什麼做 Gears」（/gears/why/，src/ui/WhyPage.tsx）的資料。名稱與連結三個語系相同，說明寫在字串。
// 內容來自 2026-11-25 的網頁搜尋與 Gears 的相依套件，改這裡的時候一起改 why.updated（AGENTS.md「為什麼做 Gears」）

// logo 是 public/peers/<logo>.png（scripts/make-peer-logos.mjs 產生，來源與授權在 licenses/peer-logos.txt）。
// 找不到官方 logo 的不寫，畫面上放一個中性的圖示佔位，不自己畫一個
export interface PeerName {
  name: string;
  url?: string;
  logo?: string;
}

// Gears 用到的開源成果：規格、程式、模型與資料。誰做的寫在 why.built.<id>.by，用在哪裡寫在 why.built.<id>。
// 程式的清單照 package.json 的執行期相依套件，模型照 src/core/model-catalog.ts，新增或換掉時一起改
export type BuiltSection = "specs" | "code" | "models" | "data";
export const BUILT_SECTIONS: readonly BuiltSection[] = ["specs", "code", "models", "data"];

export const BUILT_ON: readonly { id: string; section: BuiltSection; names: PeerName[] }[] = [
  { id: "c2pa", section: "specs", names: [{ name: "C2PA", url: "https://c2pa.org/" }] },
  { id: "iptc", section: "specs", names: [{ name: "IPTC Photo Metadata", url: "https://iptc.org/standards/photo-metadata/" }] },
  { id: "openpgp", section: "specs", names: [{ name: "OpenPGP", url: "https://www.rfc-editor.org/rfc/rfc9580" }] },
  { id: "age", section: "specs", names: [{ name: "age", url: "https://age-encryption.org/" }] },
  { id: "pades", section: "specs", names: [{ name: "RFC 3161", url: "https://www.rfc-editor.org/rfc/rfc3161" }, { name: "PAdES" }] },
  { id: "pdfjs", section: "code", names: [{ name: "pdf.js", url: "https://github.com/mozilla/pdf.js" }] },
  { id: "pdflib", section: "code", names: [{ name: "pdf-lib", url: "https://github.com/Hopding/pdf-lib" }] },
  { id: "libheif", section: "code", names: [{ name: "libheif", url: "https://github.com/strukturag/libheif" }, { name: "libde265", url: "https://github.com/strukturag/libde265" }] },
  { id: "barcode", section: "code", names: [{ name: "ZXing-C++", url: "https://github.com/zxing-cpp/zxing-cpp" }, { name: "jsQR", url: "https://github.com/cozmo/jsQR" }] },
  { id: "crypto", section: "code", names: [{ name: "typage", url: "https://github.com/FiloSottile/typage" }, { name: "noble", url: "https://paulmillr.com/noble/" }] },
  { id: "openpgpjs", section: "code", names: [{ name: "OpenPGP.js", url: "https://openpgpjs.org/" }] },
  { id: "c2pars", section: "code", names: [{ name: "c2pa-rs", url: "https://github.com/contentauth/c2pa-rs" }] },
  { id: "pkijs", section: "code", names: [{ name: "PKI.js", url: "https://github.com/PeculiarVentures/PKI.js" }] },
  {
    id: "runtime",
    section: "code",
    names: [
      { name: "ONNX Runtime", url: "https://github.com/microsoft/onnxruntime" },
      { name: "Transformers.js", url: "https://github.com/huggingface/transformers.js" },
    ],
  },
  { id: "sherpa", section: "code", names: [{ name: "sherpa-onnx", url: "https://github.com/k2-fsa/sherpa-onnx" }] },
  { id: "opencc", section: "code", names: [{ name: "OpenCC", url: "https://github.com/nk2028/opencc-js" }] },
  { id: "preact", section: "code", names: [{ name: "Preact", url: "https://preactjs.com/" }] },
  { id: "whisper", section: "models", names: [{ name: "Whisper", url: "https://github.com/openai/whisper" }] },
  { id: "breeze", section: "models", names: [{ name: "Breeze-ASR", url: "https://huggingface.co/MediaTek-Research/Breeze-ASR-25" }] },
  { id: "omni", section: "models", names: [{ name: "Omnilingual ASR", url: "https://huggingface.co/facebook/omniASR-CTC-300M" }] },
  { id: "ppocr", section: "models", names: [{ name: "PP-OCR", url: "https://github.com/PaddlePaddle/PaddleOCR" }] },
  { id: "yunet", section: "models", names: [{ name: "YuNet", url: "https://github.com/opencv/opencv_zoo" }] },
  { id: "nympii", section: "models", names: [{ name: "nym-pii", url: "https://huggingface.co/Wismut/nym-pii-multilingual" }] },
  { id: "vad", section: "models", names: [{ name: "Silero VAD", url: "https://github.com/snakers4/silero-vad" }] },
  { id: "campp", section: "models", names: [{ name: "CAM++", url: "https://github.com/modelscope/3D-Speaker" }] },
  { id: "punct", section: "models", names: [{ name: "multilingual-punctuation-truecase", url: "https://huggingface.co/Horizon-Labs/multilingual-punctuation-truecase-small" }] },
  {
    id: "similar",
    section: "models",
    names: [
      { name: "DINOv2", url: "https://github.com/facebookresearch/dinov2" },
      { name: "PDQ", url: "https://github.com/facebook/ThreatExchange/tree/main/pdq" },
    ],
  },
  { id: "scam165", section: "data", names: [{ name: "165", url: "https://data.gov.tw/dataset/176455" }] },
  { id: "diceware", section: "data", names: [{ name: "asian-diceware", url: "https://github.com/anoni-net/asian-diceware" }] },
  { id: "mdi", section: "data", names: [{ name: "Material Design Icons", url: "https://pictogrammers.com/library/mdi/" }] },
];

// 其他也在做同類工具的專案。誰做的與形式寫在 why.peer.<id>.who、.form，介紹寫在 .body。
// section 照桌面的三組（TOOL_GROUPS），台灣的工具另外一段
export type PeerSection = GroupId | "taiwan";
export const PEER_SECTIONS: readonly PeerSection[] = ["handover", "send", "check", "taiwan"];

export const PEERS: readonly { id: string; section: PeerSection; names: PeerName[] }[] = [
  {
    id: "mat2",
    section: "handover",
    names: [
      { name: "Metadata Cleaner", url: "https://apps.gnome.org/MetadataCleaner/", logo: "metadatacleaner" },
      { name: "mat2", url: "https://github.com/jvoisin/mat2", logo: "mat2" },
    ],
  },
  { id: "imagescrubber", section: "handover", names: [{ name: "Image Scrubber", url: "https://github.com/everestpipkin/image-scrubber", logo: "imagescrubber" }] },
  { id: "dface", section: "handover", names: [{ name: "DFACE.app", url: "https://adam.harvey.studio/dface/", logo: "dface" }] },
  { id: "obscuracam", section: "handover", names: [{ name: "ObscuraCam", url: "https://guardianproject.info/apps/", logo: "obscuracam" }] },
  {
    id: "atrain",
    section: "handover",
    names: [
      { name: "aTrain", url: "https://business-analytics.uni-graz.at/en/research/atrain/", logo: "atrain" },
      { name: "noScribe", url: "https://github.com/kaixxx/noScribe", logo: "noscribe" },
    ],
  },
  { id: "anonymouth", section: "handover", names: [{ name: "Anonymouth", url: "https://drexel.edu/news/archive/2012/january/engineers-release-authorship-software", logo: "anonymouth" }] },
  { id: "onionshare", section: "send", names: [{ name: "OnionShare", url: "https://onionshare.org/", logo: "onionshare" }] },
  { id: "pairdrop", section: "send", names: [{ name: "PairDrop", url: "https://github.com/schlagmichdoch/PairDrop", logo: "pairdrop" }] },
  { id: "wormhole", section: "send", names: [{ name: "Wormhole", url: "https://wormhole.app/security", logo: "wormhole" }] },
  { id: "dangerzone", section: "check", names: [{ name: "Dangerzone", url: "https://dangerzone.rocks/", logo: "dangerzone" }] },
  { id: "invid", section: "check", names: [{ name: "InVID-WeVerify", url: "https://bellingcat.gitbook.io/toolkit/more/all-tools/invid", logo: "invid" }] },
  { id: "c2pa", section: "check", names: [{ name: "Content Credentials Verify", url: "https://opensource.contentauthenticity.org/docs/verify", logo: "c2pa" }] },
  {
    id: "tella",
    section: "check",
    names: [
      { name: "Tella", url: "https://github.com/Horizontal-org/Tella-Android-FOSS", logo: "tella" },
      { name: "ProofMode", url: "https://guardianproject.info/tags/proofmode/", logo: "proofmode" },
    ],
  },
  { id: "cyberchef", section: "check", names: [{ name: "CyberChef", url: "https://gchq.github.io/CyberChef/", logo: "cyberchef" }] },
  { id: "autoarchiver", section: "check", names: [{ name: "Auto Archiver", url: "https://github.com/bellingcat/auto-archiver", logo: "autoarchiver" }] },
  { id: "cofacts", section: "taiwan", names: [{ name: "Cofacts", url: "https://github.com/cofacts", logo: "cofacts" }] },
  { id: "factcheck", section: "taiwan", names: [{ name: "g0v fact-check-api", logo: "g0v" }] },
  { id: "whoscall", section: "taiwan", names: [{ name: "Whoscall", url: "https://whoscall.com/", logo: "whoscall" }] },
  { id: "maipian", section: "taiwan", names: [{ name: "麥騙 NoMoreScamTW", url: "https://data.gov.tw/dataset/176455" }] },
];
