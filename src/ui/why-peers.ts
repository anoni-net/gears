import type { GroupId } from "./tool-meta.ts";

// 「為什麼做 Gears」（/gears/why/，src/ui/WhyPage.tsx）列出的同類工具。名稱與連結三個語系相同，
// 誰做的、形式、說明與對照表的「檔案經過誰」寫在字串（why.peer.<id>.who、.form、.body、.path）。
// 內容來自 2026-11-25 的網頁搜尋，改這裡的時候一起改 why.updated（AGENTS.md「為什麼做 Gears」）
//
// - section：列在哪一段，三組照桌面的分組（TOOL_GROUPS），台灣的工具另外一段
// - relation：跟 Gears 的關係。reference 是 Gears 照著它訂了範圍或做法，similar 是功能重疊，complement 是處理同一件事的另一段
// - covers：對照表裡涵蓋 Gears 的哪幾組，沒有的不列進對照表（用途跟三組對不上），有的要有 why.peer.<id>.path

export type Relation = "reference" | "similar" | "complement";
export type PeerSection = GroupId | "taiwan";

// logo 是 public/peers/<logo>.png（scripts/make-peer-logos.mjs 產生，來源與授權在 licenses/peer-logos.txt）。
// 找不到官方 logo 的不寫，畫面上放一個中性的圖示佔位，不自己畫一個
export interface PeerName {
  name: string;
  url?: string;
  logo?: string;
}

export interface Peer {
  id: string;
  names: PeerName[];
  section: PeerSection;
  relation: Relation;
  covers?: GroupId[];
}

export const RELATIONS: readonly Relation[] = ["reference", "similar", "complement"];
export const PEER_SECTIONS: readonly PeerSection[] = ["handover", "send", "check", "taiwan"];

export const PEERS: readonly Peer[] = [
  {
    id: "mat2",
    names: [
      { name: "Metadata Cleaner", url: "https://apps.gnome.org/MetadataCleaner/", logo: "metadatacleaner" },
      { name: "mat2", url: "https://github.com/jvoisin/mat2", logo: "mat2" },
    ],
    section: "handover",
    relation: "reference",
    covers: ["handover"],
  },
  { id: "imagescrubber", names: [{ name: "Image Scrubber", url: "https://github.com/everestpipkin/image-scrubber", logo: "imagescrubber" }], section: "handover", relation: "similar", covers: ["handover"] },
  { id: "dface", names: [{ name: "DFACE.app", url: "https://adam.harvey.studio/dface/", logo: "dface" }], section: "handover", relation: "similar", covers: ["handover"] },
  { id: "obscuracam", names: [{ name: "ObscuraCam", url: "https://guardianproject.info/apps/", logo: "obscuracam" }], section: "handover", relation: "similar", covers: ["handover"] },
  {
    id: "atrain",
    names: [
      { name: "aTrain", url: "https://business-analytics.uni-graz.at/en/research/atrain/", logo: "atrain" },
      { name: "noScribe", url: "https://github.com/kaixxx/noScribe", logo: "noscribe" },
    ],
    section: "handover",
    relation: "similar",
    covers: ["handover"],
  },
  { id: "anonymouth", names: [{ name: "Anonymouth", url: "https://drexel.edu/news/archive/2012/january/engineers-release-authorship-software", logo: "anonymouth" }], section: "handover", relation: "similar" },
  { id: "onionshare", names: [{ name: "OnionShare", url: "https://onionshare.org/", logo: "onionshare" }], section: "send", relation: "complement", covers: ["send"] },
  { id: "pairdrop", names: [{ name: "PairDrop", url: "https://github.com/schlagmichdoch/PairDrop", logo: "pairdrop" }], section: "send", relation: "similar", covers: ["send"] },
  { id: "wormhole", names: [{ name: "Wormhole", url: "https://wormhole.app/security", logo: "wormhole" }], section: "send", relation: "similar", covers: ["send"] },
  { id: "dangerzone", names: [{ name: "Dangerzone", url: "https://dangerzone.rocks/", logo: "dangerzone" }], section: "check", relation: "reference", covers: ["check"] },
  { id: "invid", names: [{ name: "InVID-WeVerify", url: "https://bellingcat.gitbook.io/toolkit/more/all-tools/invid", logo: "invid" }], section: "check", relation: "similar", covers: ["check"] },
  { id: "c2pa", names: [{ name: "Content Credentials Verify", url: "https://opensource.contentauthenticity.org/docs/verify", logo: "c2pa" }], section: "check", relation: "reference", covers: ["check"] },
  {
    id: "tella",
    names: [
      { name: "Tella", url: "https://github.com/Horizontal-org/Tella-Android-FOSS", logo: "tella" },
      { name: "ProofMode", url: "https://guardianproject.info/tags/proofmode/", logo: "proofmode" },
    ],
    section: "check",
    relation: "complement",
  },
  { id: "cyberchef", names: [{ name: "CyberChef", url: "https://gchq.github.io/CyberChef/", logo: "cyberchef" }], section: "check", relation: "similar" },
  { id: "autoarchiver", names: [{ name: "Auto Archiver", url: "https://github.com/bellingcat/auto-archiver", logo: "autoarchiver" }], section: "check", relation: "complement" },
  { id: "cofacts", names: [{ name: "Cofacts", url: "https://github.com/cofacts", logo: "cofacts" }], section: "taiwan", relation: "complement", covers: ["check"] },
  { id: "whoscall", names: [{ name: "Whoscall", url: "https://whoscall.com/", logo: "whoscall" }], section: "taiwan", relation: "similar", covers: ["check"] },
  { id: "maipian", names: [{ name: "麥騙 NoMoreScamTW", url: "https://data.gov.tw/dataset/176455" }], section: "taiwan", relation: "similar" },
];

// 「其他工具用 AI 的方式」：說明在 why.ai.<id>。g0v 的 fact-check-api 不在上面的清單，名稱另外寫
export const AI_NOTES: readonly { id: string; names: PeerName[] }[] = [
  { id: "atrain", names: PEERS.find((p) => p.id === "atrain")!.names },
  { id: "dface", names: PEERS.find((p) => p.id === "dface")!.names },
  { id: "invid", names: PEERS.find((p) => p.id === "invid")!.names },
  { id: "whoscall", names: PEERS.find((p) => p.id === "whoscall")!.names },
  { id: "factcheck", names: [{ name: "g0v fact-check-api", logo: "g0v" }] },
];

// 「Gears 參考與銜接的專案」：標題與說明在 why.links.<id>.title、.body，logos 是標題前面的圖示（165 清單是資料，沒有圖示）
export const LINKS: readonly { id: string; logos: string[] }[] = [
  { id: "mat2", logos: ["mat2"] },
  { id: "dangerzone", logos: ["dangerzone"] },
  { id: "c2pa", logos: ["c2pa", "proofmode"] },
  { id: "onionshare", logos: ["onionshare"] },
  { id: "scam165", logos: [] },
];

// 「Gears 補上的部分」的項目數：why.gaps.<n>.title、.body
export const GAPS = 5;
