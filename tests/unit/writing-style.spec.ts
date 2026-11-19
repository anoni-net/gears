import { expect, test } from "@playwright/test";
import { addedNumbers, missingFacts } from "../../src/tools/writing-style/facts.ts";
import { PII_KINDS } from "../../src/tools/redact/pii.ts";
import { FIXABLE, HABIT_CODES, applyHabits, countHabits, findHabits, fixHabits, nextAlias, replaceInParts, replaceTerm, tagPii } from "../../src/tools/writing-style/index.ts";

const codes = (text: string) => findHabits(text).map((h) => [h.code, h.text.trim()]);

test("表情符號、顏文字與笑聲，刪掉時兩句之間補逗號", () => {
  expect(codes("受不了了😤 主管又來了 (╯°□°)╯ XD")).toEqual([
    ["emoji", "😤"],
    ["emoji", "(╯°□°)"],
    ["laugh", "XD"],
  ]);
  expect(fixHabits("受不了了😤 主管又來了")).toBe("受不了了，主管又來了");
  expect(fixHabits("路過的人都看得到😱😱 我上禮拜拍到了")).toBe("路過的人都看得到，我上禮拜拍到了");
  expect(fixHabits("好👍🏻")).toBe("好");
  expect(fixHabits("好累喔哈哈哈")).toBe("好累喔");
  // 網址裡的 www 不是笑聲
  expect(codes("到 www.example.com 看")).toEqual([["pii", "www.example.com"]]);
});

test("重複的標點與波浪號，數字範圍裡的波浪號不動", () => {
  expect(fixHabits("真的假的!!!太扯了吧???")).toBe("真的假的！太扯了吧？");
  expect(fixHabits("好喔~~ 我知道了")).toBe("好喔，我知道了");
  expect(fixHabits("然後...就沒有然後了。。。")).toBe("然後……就沒有然後了……");
  expect(fixHabits("3~5 天")).toBe("3~5 天");
});

test("中文句子裡的半形標點換成全形，小數點、時間、網址與英文句子不動", () => {
  expect(fixHabits("各位好,我是工程師.最近很忙!")).toBe("各位好，我是工程師。最近很忙！");
  expect(fixHabits("這樣很不OK.")).toBe("這樣很不OK。");
  expect(fixHabits("他說(很大聲)不行")).toBe("他說（很大聲）不行");
  expect(fixHabits("預算 3.5 萬，10:30 開會")).toBe("預算 3.5 萬，10:30 開會");
  expect(fixHabits("He said hello, then left.")).toBe("He said hello, then left.");
  expect(fixHabits("詳見 e.g. 這份")).toBe("詳見 e.g. 這份");
});

test("引號換成「」，全形英數換成半形，段首空格與空格斷句", () => {
  expect(fixHabits('他說"先上線再說"')).toBe("他說「先上線再說」");
  expect(fixHabits("他說“先上線再說”")).toBe("他說「先上線再說」");
  expect(fixHabits("編號ＡＢ１２３")).toBe("編號AB123");
  expect(fixHabits("　　今天開會\n\n\n\n明天放假")).toBe("今天開會\n\n明天放假");
  expect(fixHabits("我覺得 其實 大家都知道")).toBe("我覺得，其實，大家都知道");
});

test("語助詞、口頭禪、注音文只標出來，不直接修正", () => {
  const text = "老實說我受不了了啦，欸你們知道嗎，ㄏㄏ";
  expect(codes(text)).toEqual([
    ["filler", "老實說"],
    ["particle", "啦"],
    ["particle", "欸"],
    ["zhuyin", "ㄏㄏ"],
  ]);
  expect(fixHabits(text)).toBe(text);
  // 「耶穌」、「喔喔」後面接的不是標點，不算句尾
  expect(codes("耶穌說")).toEqual([]);
  // 其實、然後用到三次才算口頭禪
  expect(codes("其實還好，其實沒事")).toEqual([]);
  expect(codes("其實還好，其實沒事，其實")).toHaveLength(3);
});

test("中英夾雜附上中文的說法，整段英文不算", () => {
  const found = findHabits("我們的App會把通訊錄上傳到server");
  expect(found.map((h) => [h.text, h.suggest])).toEqual([
    ["App", "應用程式"],
    ["server", "伺服器"],
  ]);
  expect(findHabits("Please check the server.")).toEqual([]);
});

test("中國用語與粵語用字附上台灣書面語的說法，長的詞先比對", () => {
  expect(findHabits("這個視頻的用戶很多").map((h) => [h.code, h.text, h.suggest])).toEqual([
    ["region-cn", "視頻", "影片"],
    ["region-cn", "用戶", "使用者"],
  ]);
  expect(findHabits("佢哋冇講").map((h) => [h.code, h.text, h.suggest])).toEqual([
    ["dialect-hk", "佢哋", "他們"],
    ["dialect-hk", "冇", "沒有"],
  ]);
});

test("電話、Email 與帳號是個資，不算中英夾雜", () => {
  const found = findHabits("請打0912-345-678或寫信到 tipster@example.com，帳號 @anon_tw");
  expect(found.map((h) => [h.code, h.pii, h.text])).toEqual([
    ["pii", "phone", "0912-345-678"],
    ["pii", "email", "tipster@example.com"],
    ["pii", "handle", "@anon_tw"],
  ]);
});

test("可以直接修正的只動標點、空白與符號，修正之後不再找到這些習慣", () => {
  const text = "老實說我真的受不了了啦😤 主管叫大家把加班時數改成8小時以內!!! 不改的話考績就會被打C~~ 他說\"誰敢講就走人\"...";
  const fixed = fixHabits(text);
  const left = countHabits(findHabits(fixed));
  for (const code of FIXABLE) expect(left[code] ?? 0, code).toBe(0);
  // 文字本身一個字都沒有少
  const words = (s: string) => s.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "");
  expect(words(fixed)).toBe(words(text).replace("XD", ""));
  expect(FIXABLE.every((c) => HABIT_CODES.includes(c))).toBe(true);
});

test("改寫前後的事實：數字、中文數字、引號裡的原話與個資", () => {
  const original = "我在公司做了三年，主管叫大家把加班改成8小時以內，他說「先上線再說」，有事寫信到 a@example.com";
  expect(missingFacts("我用了一個第三方的套件，問了兩次", "我使用第三方套件，詢問了兩次")).toEqual([]);
  expect(missingFacts(original, "我在公司工作了3年。主管要求把加班時數改成8小時以內，他說：「先上線再說」。聯絡信箱 a@example.com")).toEqual([]);
  expect(missingFacts(original, "我在公司工作多年。主管要求把加班時數改成十小時以內，他表示會先上線再處理。").map((f) => [f.kind, f.text])).toEqual([
    ["pii", "a@example.com"],
    ["number", "8"],
    ["number", "三"],
    ["quote", "先上線再說"],
  ]);
});

test("改寫後多出的數字：捏造的精確數字要標出來，冠詞、列舉與序數換成阿拉伯數字不算", () => {
  const original = "系統裡有全台大概二十幾家分店的資料，我在十月一日問了一個主管，他提出三點：一、範圍；二、時間。這是第三次了";
  // 研究裡 Qwen3 4B 把「大概二十幾家」寫成「約二十三家」
  expect(addedNumbers(original, "系統裡有全台約二十三家分店的資料").map((f) => f.text)).toEqual(["二十三"]);
  expect(addedNumbers(original, "系統裡有全台約二十多家分店的資料，我在10月1日詢問1位主管，他提出3點：1. 範圍；2. 時間。這是第3次")).toEqual([]);
  // 同一個數字只列一次，個資裡的數字不算
  expect(addedNumbers("請打電話給我", "請在 5 天內、5 點前打 0912-345-678 給我").map((f) => f.text)).toEqual(["5"]);
});

test("逐項套用建議：只改選的那幾處，刪掉語助詞與口頭禪之後不留多餘的逗號", () => {
  const text = "老實說，這個視頻的用戶很多啦，我們的 App 會上傳到server，其他視頻也一樣";
  const habits = findHabits(text);
  const pick = (word: string) => habits.filter((h) => h.text.trim() === word);
  // 只改第一個「視頻」所在的那一組，同樣的寫法一起改
  expect(applyHabits(text, pick("視頻"))).toBe("老實說，這個影片的用戶很多啦，我們的 App 會上傳到server，其他影片也一樣");
  expect(applyHabits(text, [...pick("老實說"), ...pick("啦")])).toBe("這個視頻的用戶很多，我們的 App 會上傳到server，其他視頻也一樣");
  // 換上中文時，夾在中文之間的空白一起拿掉
  expect(applyHabits(text, [...pick("App"), ...pick("server")])).toBe("老實說，這個視頻的用戶很多啦，我們的應用程式會上傳到伺服器，其他視頻也一樣");
  // 沒有建議寫法的不動：用到三次的「其實」、注音文
  const plain = "其實還好，其實沒事，其實ㄏㄏ";
  expect(applyHabits(plain, findHabits(plain))).toBe(plain);
});

test("個資換成代稱：只換讀者選的，代稱的括號跟中文一樣前後不留空白", () => {
  const tags = { phone: "〔電話〕", email: "〔Email〕", id: "〔身分證號碼〕", card: "〔卡號〕", ip: "〔IP 位址〕", plate: "〔車牌〕", number: "〔號碼〕", url: "〔網址〕", handle: "〔帳號〕" };
  const text = "有事打 0912-345-678 或寫信到 tipster@example.com，帳號 @anon_tw";
  // 沒有代稱時個資沒有建議寫法，套用也不會動
  expect(applyHabits(text, findHabits(text))).toBe(text);
  const habits = tagPii(findHabits(text), tags);
  expect(habits.filter((h) => h.code === "pii").map((h) => [h.text, h.suggest])).toEqual([
    ["0912-345-678", "〔電話〕"],
    ["tipster@example.com", "〔Email〕"],
    ["@anon_tw", "〔帳號〕"],
  ]);
  // 其他習慣的建議不受影響
  expect(tagPii(findHabits("這個視頻"), tags).map((h) => h.suggest)).toEqual(["影片"]);
  const pick = (kind: string) => habits.filter((h) => h.pii === kind);
  expect(applyHabits(text, pick("phone"))).toBe("有事打〔電話〕或寫信到 tipster@example.com，帳號 @anon_tw");
  expect(applyHabits(text, habits.filter((h) => h.code === "pii"))).toBe("有事打〔電話〕或寫信到〔Email〕，帳號〔帳號〕");
  // 英文的代稱照樣保留空白
  const en = { ...tags, phone: "[phone]" };
  expect(applyHabits("Call 0912-345-678 now", tagPii(findHabits("Call 0912-345-678 now"), en).filter((h) => h.code === "pii"))).toBe("Call [phone] now");
});

test("換上的代稱不再被標成寫作習慣，三個語系的代稱都一樣", async () => {
  const { zhTW } = await import("../../src/i18n/zh-TW.ts");
  const { zhCN } = await import("../../src/i18n/zh-CN.ts");
  const { en } = await import("../../src/i18n/en.ts");
  for (const messages of [zhTW, zhCN, en] as Record<string, string>[]) {
    const tags = Object.entries(messages).filter(([k]) => k.startsWith("style.piiTag.")).map(([, v]) => v);
    expect(tags).toHaveLength(PII_KINDS.length);
    // 中文句子與英文句子裡各放一次
    const text = `有事打${tags.join("，或是")}給我。Call me at ${tags.join(" or ")} now`;
    const spans = tags.flatMap((tag) => [...text.matchAll(new RegExp(tag.replace(/[[\]]/g, "\\$&"), "g"))].map((m) => [m.index, m.index + tag.length]));
    const inside = findHabits(text, tags).filter((h) => spans.some(([s, e]) => h.start < e! && h.end > s!));
    expect(inside, text).toEqual([]);
  }
  // 沒有傳入代稱時照舊，〔Email〕裡的英文算中英夾雜
  expect(findHabits("寫信到〔Email〕").map((h) => h.code)).toEqual(["english"]);
  expect(findHabits("寫信到〔Email〕", ["〔Email〕"])).toEqual([]);
});

test("自己指定要換掉的字：全部換成同一個代稱，下一個代稱換字母，代稱裡的字不動", () => {
  const format = (letter: string) => `〔人名 ${letter}〕`;
  const text = "林組長說小美跟 林組長 都知道";
  expect(nextAlias(text, format)).toBe("〔人名 A〕");
  const first = replaceTerm(text, " 林組長 ", "〔人名 A〕");
  expect(first).toEqual({ text: "〔人名 A〕說小美跟〔人名 A〕都知道", count: 2 });
  expect(nextAlias(first.text, format)).toBe("〔人名 B〕");
  expect(replaceTerm(first.text, "小美", nextAlias(first.text, format)).text).toBe("〔人名 A〕說〔人名 B〕跟〔人名 A〕都知道");
  // 指定的字剛好出現在代稱裡時，代稱不動
  expect(replaceTerm(first.text, "人名", "〔代稱 A〕", [format("A")])).toEqual({ text: first.text, count: 0 });
  // 沒有出現、空白的字不動
  expect(replaceTerm(text, "王", "〔人名 A〕").count).toBe(0);
  expect(replaceTerm(text, "  ", "〔人名 A〕")).toEqual({ text, count: 0 });
  // 英文的代稱保留空白
  expect(replaceTerm("Ask Kevin or Kevin's boss", "Kevin", "[Person A]").text).toBe("Ask [Person A] or [Person A]'s boss");
  // 換上的代稱不再被標成寫作習慣
  const keep = ["〔人名 A〕", "[Person A]"];
  expect(findHabits("問〔人名 A〕就知道", keep)).toEqual([]);
  expect(findHabits("問 [Person A] 就知道", keep)).toEqual([]);
});

test("逐字稿這類分段的文字：每一段各自換，時間與說話者不動，切在兩段之間的換不到", () => {
  const parts = [
    { start: 0, end: 2, text: "王經理說明天開會", speaker: 0 },
    { start: 2, end: 4, text: "我跟王經理不熟", speaker: 1 },
    { start: 4, end: 5, text: "王", speaker: 1 },
    { start: 5, end: 6, text: "經理也來了", speaker: 1 },
  ];
  const result = replaceInParts(parts, "王經理", "〔人名 A〕");
  expect(result.count).toBe(2);
  expect(result.parts.map((p) => p.text)).toEqual(["〔人名 A〕說明天開會", "我跟〔人名 A〕不熟", "王", "經理也來了"]);
  expect(result.parts.map((p) => [p.start, p.speaker])).toEqual(parts.map((p) => [p.start, p.speaker]));
  // 沒有換到的段落沿用原本的物件，整份沒有換到時回傳原本的陣列
  expect(result.parts[2]).toBe(parts[2]);
  expect(replaceInParts(parts, "李", "〔人名 B〕").parts).toBe(parts);
});
