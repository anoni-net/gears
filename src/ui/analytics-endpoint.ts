// 使用統計送到哪裡（src/ui/analytics.ts）。vite.config.ts 把這個網址寫進 CSP 的 connect-src，
// 所以獨立成一個沒有相依的檔案
export const ANALYTICS_ENDPOINT = "https://aa.anoni.net/api/send";
export const ANALYTICS_WEBSITE = "bfcd8990-a763-4213-8753-6c484c164d8c"; // Umami 上的 anoni-net-gears
