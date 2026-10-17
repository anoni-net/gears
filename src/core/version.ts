// 工作台的版本號。用 commit 的時間（台灣時間）寫成「年.月.日 時:分」，不必手動調整，
// 同一個 commit 每次建置都得到同一個版本號。只寫日期的話，同一天合併好幾次時更新的提示
// 一直顯示同一個版本號，讀者分不出差別，所以寫到分鐘。
// vite.config.ts 在建置時算好，頁面上用 src/version.ts 讀

export function calver(epochSeconds: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
