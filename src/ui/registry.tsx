import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import type { CreateToolProps, FileEditorProps } from "./types.ts";

// 從空白開始的工具各自帶一個填寫用的介面。src/tools/index.ts 的 createTools
// 列出 id，這裡對應到元件。元件與它用到的函式庫在打開工具時才下載，桌面維持輕量。
const loaders: Record<string, () => Promise<ComponentType<CreateToolProps>>> = {
  qrcode: () => import("./QrTool.tsx").then((m) => m.QrTool),
  passphrase: () => import("./PassphraseTool.tsx").then((m) => m.PassphraseTool),
  "url-check": () => import("./UrlCheckTool.tsx").then((m) => m.UrlCheckTool),
  "qr-read": () => import("./QrReadTool.tsx").then((m) => m.QrReadTool),
  "age-keygen": () => import("./KeygenTool.tsx").then((m) => m.KeygenTool),
  "text-crypt": () => import("./TextCryptTool.tsx").then((m) => m.TextCryptTool),
  verify: () => import("./VerifyTool.tsx").then((m) => m.VerifyTool),
  "email-check": () => import("./EmailTool.tsx").then((m) => m.EmailTool),
};

export function CreateToolView({ id, ...props }: CreateToolProps & { id: string }) {
  const [View, setView] = useState<ComponentType<CreateToolProps> | null>(null);
  useEffect(() => {
    let alive = true;
    setView(null);
    void loaders[id]!().then((component) => {
      if (alive) setView(() => component);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return View ? <View {...props} /> : <p class="hint">{t("app.loading")}</p>;
}

// 需要編輯畫面的檔案工具，對應 src/tools/index.ts 的 editorTools
const editors: Record<string, () => Promise<ComponentType<FileEditorProps>>> = {
  redact: () => import("./RedactEditor.tsx").then((m) => m.RedactEditor),
  encrypt: () => import("./AgeEditors.tsx").then((m) => m.EncryptEditor),
  decrypt: () => import("./AgeEditors.tsx").then((m) => m.DecryptEditor),
  "heic-to-jpeg": () => import("./HeicConvert.tsx").then((m) => m.HeicConvert),
  "pdf-pages": () => import("./PdfPagesEditor.tsx").then((m) => m.PdfPagesEditor),
  transcribe: () => import("./TranscribeEditor.tsx").then((m) => m.TranscribeEditor),
};

export function FileEditorView({ id, ...props }: FileEditorProps & { id: string }) {
  const [View, setView] = useState<ComponentType<FileEditorProps> | null>(null);
  useEffect(() => {
    let alive = true;
    setView(null);
    void editors[id]!().then((component) => {
      if (alive) setView(() => component);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return View ? <View {...props} /> : <p class="hint">{t("app.loading")}</p>;
}
