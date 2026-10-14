// 165 反詐騙諮詢專線公開的「遭停止解析涉詐網站」清單（政府資料開放平台，資料集
// 176455，政府資料開放授權條款第 1 版）。scripts/fetch-165.mjs 把它整理成一行一個網域，
// 整份在瀏覽器裡比對，讀者輸入的網址不送到任何地方。

export interface ScamList {
  domains: Set<string>;
  from?: string; // 資料涵蓋的第一個月，YYYY-MM
  to?: string; // 最後一個月
}

// 第一行是說明，格式 `# from=2025-12 to=2026-09 count=86173`
export function parseScamList(text: string): ScamList {
  const lines = text.split("\n");
  const list: ScamList = { domains: new Set() };
  for (const line of lines) {
    if (line.startsWith("#")) {
      list.from = /from=(\d{4}-\d{2})/.exec(line)?.[1] ?? list.from;
      list.to = /to=(\d{4}-\d{2})/.exec(line)?.[1] ?? list.to;
      continue;
    }
    const domain = line.trim();
    if (domain) list.domains.add(domain);
  }
  return list;
}

// 主機名本身或它的上層網域在清單裡就算命中，例如清單有 example.cc，
// www.example.cc 也命中。清單裡沒有共用平台本身（netlify.app 這類），
// 所以往上比對不會把整個平台當成詐騙。
export function findScam(host: string, list: ScamList): string | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    if (list.domains.has(candidate)) return candidate;
  }
  return null;
}
