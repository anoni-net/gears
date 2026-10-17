import { expect, test } from "@playwright/test";
import { missingFacts } from "../../src/tools/writing-style/facts.ts";
import { FIXABLE, HABIT_CODES, countHabits, findHabits, fixHabits } from "../../src/tools/writing-style/index.ts";

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
