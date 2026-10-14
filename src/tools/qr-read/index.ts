// QR code 讀取的純邏輯：解讀 QR code 裡常見的內容格式。影像解碼在 src/ui/qr-scan.ts。

export type QrContent =
  | { kind: "url"; url: string }
  | { kind: "wifi"; ssid: string; password: string; security: string; hidden: boolean }
  | { kind: "text"; text: string };

// Wi-Fi 格式：WIFI:T:WPA;S:名稱;P:密碼;H:true;;，反斜線跳脫特殊字元
export function parseWifi(text: string): Extract<QrContent, { kind: "wifi" }> | null {
  if (!/^WIFI:/i.test(text)) return null;
  const fields: Record<string, string> = {};
  let key = "";
  let value = "";
  let readingKey = true;
  for (let i = 5; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length) {
      value += text[++i];
    } else if (readingKey && ch === ":") {
      readingKey = false;
    } else if (readingKey) {
      key += ch;
    } else if (ch === ";") {
      if (key) fields[key.toUpperCase()] = value;
      key = "";
      value = "";
      readingKey = true;
    } else {
      value += ch;
    }
  }
  if (!("S" in fields)) return null;
  return {
    kind: "wifi",
    ssid: fields.S!,
    password: fields.P ?? "",
    security: fields.T || "nopass",
    hidden: fields.H?.toLowerCase() === "true",
  };
}

export function classify(text: string): QrContent {
  const wifi = parseWifi(text);
  if (wifi) return wifi;
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return { kind: "url", url: trimmed };
  return { kind: "text", text };
}
