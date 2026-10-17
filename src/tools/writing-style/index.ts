import { type PiiKind, findPiiInText } from "../redact/pii.ts";

// 寫作習慣檢查：匿名交出的文字，常因為寫作習慣被認出是誰寫的，例如固定用的表情符號、
// 語助詞、標點、中英夾雜與地區用語。這裡找出這些習慣，機械性的可以直接修正，
// 其他的標出來，由讀者自己改。只用固定的規則，結果每次都一樣，不會改到內容的意思。
//
// 基準是台灣正體中文的書面語：中國用語與粵語用字會標出來，台灣用語不標。
// 評測模型改寫時（社群工作區的 research/gears-llm/）也用這份規則計算剩下多少習慣。

export type HabitCode =
  | "emoji" // 表情符號、顏文字
  | "laugh" // 哈哈哈、XD、www
  | "punct-repeat" // !!!、~~、...
  | "punct-halfwidth" // 中文句子裡的半形標點
  | "quotes" // 中文句子裡的 "" 與 “”
  | "fullwidth-alnum" // 全形的英文字母與數字
  | "layout" // 段首空格、字與字之間的空格、連續空行
  | "particle" // 句尾語助詞：啦、喔、欸
  | "filler" // 口頭禪：老實說、說真的，以及用太多次的其實、然後
  | "english" // 中英夾雜
  | "region-cn" // 中國用語
  | "dialect-hk" // 粵語用字
  | "zhuyin" // 注音文
  | "pii"; // 電話、Email、身分證字號這類個資

export const HABIT_CODES: readonly HabitCode[] = [
  "emoji",
  "laugh",
  "punct-repeat",
  "punct-halfwidth",
  "quotes",
  "fullwidth-alnum",
  "layout",
  "particle",
  "filler",
  "english",
  "region-cn",
  "dialect-hk",
  "zhuyin",
  "pii",
];

// 可以直接修正的項目：只動標點、空白與符號，不動文字
export const FIXABLE: readonly HabitCode[] = ["emoji", "laugh", "punct-repeat", "punct-halfwidth", "quotes", "fullwidth-alnum", "layout"];

export interface Habit {
  code: HabitCode;
  start: number;
  end: number;
  text: string;
  fix?: string; // 直接修正時換成的文字，空字串是刪掉
  suggest?: string; // 建議的寫法，讀者自己決定要不要改
  pii?: PiiKind;
}

const HAN = "\\p{Script=Han}";
const isHan = (c: string | undefined) => !!c && /\p{Script=Han}/u.test(c);
const isWordy = (c: string | undefined) => !!c && /[\p{Script=Han}A-Za-z0-9]/u.test(c);

// 刪掉一段符號時，兩邊都是文字就補一個逗號，避免兩句接成一句
function removal(text: string, start: number, end: number): { start: number; end: number; fix: string } {
  let s = start;
  let e = end;
  while (s > 0 && /[ \t　]/.test(text[s - 1]!)) s--;
  while (e < text.length && /[ \t　]/.test(text[e]!)) e++;
  const before = text[s - 1];
  const after = text[e];
  return { start: s, end: e, fix: isWordy(before) && isWordy(after) ? "，" : "" };
}

function push(out: Habit[], text: string, code: HabitCode, start: number, end: number, extra: Partial<Habit> = {}) {
  out.push({ code, start, end, text: text.slice(start, end), ...extra });
}

function emoji(text: string, out: Habit[]) {
  const patterns = [
    // 連續的幾個表情符號算一個，刪掉時才知道兩邊是不是文字
    /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*[ \t\u3000]*)+/gu,
    // 顏文字：括號裡有表情用的符號
    /[(（][^()（）\n]{0,8}[\^_;´`‿ω°▽∀≧≦⊙∩ﾟ･ε≖◕][^()（）\n]{0,8}[)）]/gu,
    /(?<![A-Za-z0-9])(?::-?[)(DPp]|;-?\)|\^[_.]?\^|=\)|<3|orz|OTZ|Orz|QQ|QAQ|T_T|TAT)(?![A-Za-z0-9])/g,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const r = removal(text, m.index, m.index + m[0].length);
      push(out, text, "emoji", r.start, r.end, { fix: r.fix });
    }
  }
}

function laugh(text: string, out: Habit[]) {
  for (const m of text.matchAll(/哈{2,}|呵{2,}|嘿{2,}|嘻{2,}|科科|(?<![A-Za-z0-9.\/])(?:XD+|xD+|w{3,}|lol|LOL)(?![A-Za-z0-9.\/])/gu)) {
    const r = removal(text, m.index, m.index + m[0].length);
    push(out, text, "laugh", r.start, r.end, { fix: r.fix });
  }
}

function punctRepeat(text: string, out: Habit[]) {
  const rules: [RegExp, string][] = [
    [/[!！]+[?？]+[!！?？]*|[?？]+[!！]+[!！?？]*/g, "？"],
    [/[!！]{2,}/g, "！"],
    [/[?？]{2,}/g, "？"],
    [/。{2,}|\.{3,}|…{3,}|(?<!…)…(?!…)|⋯+/g, "……"],
    [/，{2,}|,{2,}/g, "，"],
  ];
  for (const [pattern, fix] of rules) {
    for (const m of text.matchAll(pattern)) push(out, text, "punct-repeat", m.index, m.index + m[0].length, { fix });
  }
  // 波浪號：句子裡拉長語氣用的，刪掉
  for (const m of text.matchAll(/[~～]+/g)) {
    if (/\d/.test(text[m.index - 1] ?? "") && /\d/.test(text[m.index + m[0].length] ?? "")) continue; // 3~5 這種範圍
    const r = removal(text, m.index, m.index + m[0].length);
    push(out, text, "punct-repeat", r.start, r.end, { fix: r.fix });
  }
}

const FULL: Record<string, string> = { ",": "，", "!": "！", "?": "？", ":": "：", ";": "；", "(": "（", ")": "）", ".": "。" };

function punctHalfwidth(text: string, out: Habit[]) {
  for (const m of text.matchAll(/[,!?:;().]/g)) {
    const c = m[0];
    const i = m.index;
    let b = i - 1;
    while (b >= 0 && text[b] === " ") b--;
    let a = i + 1;
    while (a < text.length && text[a] === " ") a++;
    const before = text[b];
    const after = text[a];
    // 小數點與時間（3.5、10:30）、縮寫與網址（e.g.、a.com）裡的不動
    if ((c === "." || c === ":") && /\d/.test(before ?? "") && /\d/.test(after ?? "")) continue;
    if (c === "." && /[A-Za-z]/.test(text[i + 1] ?? "")) continue;
    if (c === "." && /[A-Za-z]\.[A-Za-z]$/.test(text.slice(Math.max(0, i - 3), i))) continue; // e.g. 的最後一個點
    // 前後至少一邊是中文才算中文句子裡的標點。中文句子結尾的英文字（很不 OK.）也算，
    // 往前找到上一個句子的開頭，那一段有中文就是中文句子。英文句子裡的不動
    if (!isHan(before) && !isHan(after)) {
      const atEnd = after === undefined || after === "\n";
      const from = Math.max(text.lastIndexOf("\n", i - 1), ...["。", "！", "？", "!", "?"].map((p) => text.lastIndexOf(p, i - 1)));
      if (!atEnd || !".!?".includes(c) || !/\p{Script=Han}/u.test(text.slice(from + 1, i))) continue;
    }
    // 連同前後的空白一起換掉
    push(out, text, "punct-halfwidth", b + 1, a, { fix: FULL[c]! });
  }
}

function quotes(text: string, out: Habit[]) {
  for (const m of text.matchAll(new RegExp(`["“]([^"“”\\n]*${HAN}[^"“”\\n]*)["”]`, "gu"))) {
    push(out, text, "quotes", m.index, m.index + m[0].length, { fix: `「${m[1]}」` });
  }
  for (const m of text.matchAll(new RegExp(`[‘]([^‘’\\n]*${HAN}[^‘’\\n]*)[’]`, "gu"))) {
    push(out, text, "quotes", m.index, m.index + m[0].length, { fix: `『${m[1]}』` });
  }
}

function fullwidthAlnum(text: string, out: Habit[]) {
  for (const m of text.matchAll(/[０-９Ａ-Ｚａ-ｚ]+/g)) {
    push(out, text, "fullwidth-alnum", m.index, m.index + m[0].length, {
      fix: m[0].replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)),
    });
  }
}

function layout(text: string, out: Habit[]) {
  // 段首空兩格
  for (const m of text.matchAll(/^[ \t　]+(?=\S)/gm)) push(out, text, "layout", m.index, m.index + m[0].length, { fix: "" });
  // 用空格代替逗號斷句的習慣，換成逗號
  for (const m of text.matchAll(new RegExp(`(?<=${HAN})[ \\u3000]+(?=${HAN})`, "gu"))) push(out, text, "layout", m.index, m.index + m[0].length, { fix: "，" });
  // 連續空行
  for (const m of text.matchAll(/\n[ \t　]*\n(?:[ \t　]*\n)+/g)) push(out, text, "layout", m.index, m.index + m[0].length, { fix: "\n\n" });
  // 行尾空白
  for (const m of text.matchAll(/[ \t　]+$/gm)) if (m[0].length) push(out, text, "layout", m.index, m.index + m[0].length, { fix: "" });
}

// 句尾語助詞：後面接標點、空白、符號或結尾才算，「耶穌」、「喔喔」裡的不算
const PARTICLES = ["啦", "喔", "哦", "欸", "誒", "耶", "齁", "捏", "惹", "囉", "唷", "呦", "吼", "咧", "der"];

function particle(text: string, out: Habit[]) {
  const pattern = new RegExp(`(?:${PARTICLES.join("|")})+(?=[\\s\\p{P}\\p{S}\\p{Extended_Pictographic}]|$)`, "gu");
  for (const m of text.matchAll(pattern)) push(out, text, "particle", m.index, m.index + m[0].length, { suggest: "" });
  // 句子開頭的發語詞：欸你們知道嗎、齁這樣不行
  for (const m of text.matchAll(/(?<=^|[\s\p{P}])(?:欸|誒|齁|吼)(?=\p{Script=Han})/gmu)) push(out, text, "particle", m.index, m.index + m[0].length, { suggest: "" });
}

// 口頭禪：出現一次就標的，與用太多次才標的
const FILLERS = ["老實說", "說真的", "講真的", "坦白說", "說實話", "講白了", "不得不說", "話說回來", "話說", "的說", "老實講", "認真說"];
const OVERUSED = ["其實", "然後", "基本上", "就是說", "真的", "超級", "反正"];
const OVERUSE_MIN = 3;

function filler(text: string, out: Habit[]) {
  for (const m of text.matchAll(new RegExp(FILLERS.join("|"), "g"))) push(out, text, "filler", m.index, m.index + m[0].length, { suggest: "" });
  for (const word of OVERUSED) {
    const hits = [...text.matchAll(new RegExp(word, "g"))];
    if (hits.length < OVERUSE_MIN) continue;
    for (const m of hits) push(out, text, "filler", m.index, m.index + m[0].length);
  }
}

// 中英夾雜。常見的詞附上中文的說法，其他的只標出來
const ENGLISH: Record<string, string> = {
  server: "伺服器",
  user: "使用者",
  users: "使用者",
  app: "應用程式",
  pm: "專案經理",
  ok: "妥當",
  email: "電子郵件",
  mail: "郵件",
  meeting: "會議",
  deadline: "截止日",
  check: "確認",
  update: "更新",
  bug: "程式錯誤",
  account: "帳號",
  password: "密碼",
  data: "資料",
  file: "檔案",
  boss: "老闆",
  case: "案子",
  sales: "業務",
  report: "報告",
  schedule: "時程",
  team: "團隊",
  leader: "主管",
  push: "催促",
  cover: "支援",
  sorry: "抱歉",
  fine: "沒問題",
  bye: "再見",
  call: "電話",
  line: "LINE",
};

function english(text: string, out: Habit[]) {
  if (!/\p{Script=Han}/u.test(text)) return; // 整段是英文就不算夾雜
  for (const m of text.matchAll(/(?<![A-Za-z0-9@._\/:-])[A-Za-z][A-Za-z'’]*(?![A-Za-z0-9@_\/:-]|\.[A-Za-z])/g)) {
    // 單一個字母多半是等第或代號（考績打 C、A 棟），不算
    if (m[0].length < 2) continue;
    const suggest = ENGLISH[m[0].toLowerCase()];
    push(out, text, "english", m.index, m.index + m[0].length, suggest && suggest !== m[0] ? { suggest } : {});
  }
}

// 中國用語，以及台灣的說法。只收意思不會混淆的，「程序」、「項目」、「支持」在台灣也用，不收
const REGION_CN: Record<string, string> = {
  視頻: "影片",
  軟件: "軟體",
  硬件: "硬體",
  信息: "訊息",
  用戶: "使用者",
  網絡: "網路",
  服務器: "伺服器",
  默認: "預設",
  質量: "品質",
  打印: "列印",
  屏幕: "螢幕",
  鼠標: "滑鼠",
  硬盤: "硬碟",
  U盤: "隨身碟",
  內存: "記憶體",
  文件夾: "資料夾",
  登錄: "登入",
  激活: "啟用",
  點贊: "按讚",
  博客: "部落格",
  短信: "簡訊",
  手機號: "手機號碼",
  靠譜: "可靠",
  二維碼: "QR code",
  充電寶: "行動電源",
  出租車: "計程車",
  打車: "叫車",
  外賣: "外送",
  公交: "公車",
  數據庫: "資料庫",
  互聯網: "網際網路",
  鏈接: "連結",
  帖子: "貼文",
  視頻號: "影音帳號",
  搞錢: "賺錢",
  給力: "很好",
  牛逼: "厲害",
  老鐵: "朋友",
  渠道: "管道",
  領導: "主管",
  對接: "聯繫",
  抓手: "切入點",
  賦能: "協助",
};

// 粵語用字與台灣書面語的說法
const DIALECT_HK: Record<string, string> = {
  佢哋: "他們",
  我哋: "我們",
  你哋: "你們",
  點解: "為什麼",
  呢度: "這裡",
  嗰度: "那裡",
  而家: "現在",
  琴日: "昨天",
  聽日: "明天",
  嘅: "的",
  咗: "了",
  喺: "在",
  佢: "他",
  冇: "沒有",
  嘢: "東西",
  啲: "些",
  畀: "給",
  唔: "不",
  睇: "看",
  嚟: "來",
  嗰: "那",
  諗: "想",
  啱: "對",
  搵: "找",
  揾: "找",
  攞: "拿",
  瞓: "睡",
  咁: "這麼",
  乜: "什麼",
  嘞: "了",
  喎: "",
  㗎: "",
  咩: "什麼",
  俾: "給",
};

function dictionary(text: string, out: Habit[], code: HabitCode, dict: Record<string, string>) {
  // 長的詞先比對，「佢哋」不會被拆成「佢」
  const words = Object.keys(dict).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  for (const m of text.matchAll(pattern)) push(out, text, code, m.index, m.index + m[0].length, { suggest: dict[m[0]] });
}

function zhuyin(text: string, out: Habit[]) {
  for (const m of text.matchAll(/[ㄅ-ㄯㆠ-ㆿˊˇˋ˙]+/g)) push(out, text, "zhuyin", m.index, m.index + m[0].length);
}

function pii(text: string, out: Habit[]) {
  for (const m of findPiiInText(text)) push(out, text, "pii", m.start, m.end, { pii: m.kind });
}

// 依 HABIT_CODES 的順序比對，前面的先佔位，重疊的後者不算（例如網址裡的英文、ㄏㄏ同時是注音）
const FINDERS: [HabitCode, (text: string, out: Habit[]) => void][] = [
  ["pii", pii],
  ["emoji", emoji],
  ["laugh", laugh],
  ["zhuyin", zhuyin],
  ["punct-repeat", punctRepeat],
  ["quotes", quotes],
  ["punct-halfwidth", punctHalfwidth],
  ["fullwidth-alnum", fullwidthAlnum],
  ["layout", layout],
  ["dialect-hk", (text, out) => dictionary(text, out, "dialect-hk", DIALECT_HK)],
  ["region-cn", (text, out) => dictionary(text, out, "region-cn", REGION_CN)],
  ["particle", particle],
  ["filler", filler],
  ["english", english],
];

export function findHabits(text: string): Habit[] {
  const result: Habit[] = [];
  for (const [, find] of FINDERS) {
    const found: Habit[] = [];
    find(text, found);
    for (const habit of found.sort((a, b) => a.start - b.start)) {
      if (habit.end <= habit.start && habit.code !== "layout") continue;
      if (result.some((r) => r.start < habit.end && r.end > habit.start)) continue;
      result.push(habit);
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

// 修正之後可能留下的痕跡：重複的逗號、逗號接句號、行首的逗號
function tidy(text: string): string {
  return text
    .replace(/，{2,}/g, "，")
    .replace(/，(?=[。！？；：）」』\n]|$)/g, "")
    .replace(/(^|\n)[，、]+/g, "$1")
    // 全形標點前後不留空白
    .replace(/[ \t]+(?=[，。！？；：、」』）])/g, "")
    .replace(/([，。！？；：、「『（])[ \t]+/g, "$1")
    .replace(/[ \t]+$/gm, "");
}

// 只修正 codes 裡、而且有 fix 的項目。修正一次可能讓另一個習慣浮出來（刪掉表情符號後兩個驚嘆號接在一起），最多重做三次
export function fixHabits(text: string, codes: readonly HabitCode[] = FIXABLE): string {
  let current = text;
  for (let round = 0; round < 3; round++) {
    const habits = findHabits(current).filter((h) => codes.includes(h.code) && h.fix !== undefined);
    if (!habits.length) break;
    let next = current;
    for (const h of [...habits].sort((a, b) => b.start - a.start)) next = next.slice(0, h.start) + h.fix + next.slice(h.end);
    next = tidy(next);
    if (next === current) break;
    current = next;
  }
  return current;
}

// 各類習慣的數量
export function countHabits(habits: Habit[]): Partial<Record<HabitCode, number>> {
  const counts: Partial<Record<HabitCode, number>> = {};
  for (const h of habits) counts[h.code] = (counts[h.code] ?? 0) + 1;
  return counts;
}
