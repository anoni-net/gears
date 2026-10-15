import { type Format, MIME, sniff } from "./bytes.ts";
import { type Finding, type Report, type Tool, ToolError } from "./tool.ts";

// 檔案暫存區。所有工具共用，每次處理產生一個新版本、原檔保留，可以退回上一步。
//
// 只放在這個分頁的記憶體裡，不寫進 localStorage、IndexedDB 或任何儲存空間。
// 關掉分頁就消失，「清空」把所有參照放掉，交給瀏覽器回收。

export interface Version {
  id: number;
  tool: string | null; // 產生這個版本的工具，null 是讀者加入的原檔
  blob: Blob;
  format: Format;
  findings: Finding[];
  report?: Report;
}

export interface TrayFile {
  id: number;
  name: string;
  versions: Version[];
}

export interface TrayState {
  files: TrayFile[];
  selected: number | null;
  busy: boolean;
}

// 處理完的檔案交出去之前先實際解碼一次，改壞的檔案不會出現在暫存區。
export type Verifier = (blob: Blob, format: Format) => Promise<void>;

type Listener = () => void;

export function createTray(tools: Tool[], verify?: Verifier) {
  let state: TrayState = { files: [], selected: null, busy: false };
  const listeners = new Set<Listener>();
  let nextId = 1;

  const set = (patch: Partial<TrayState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const inspect = async (bytes: Uint8Array, format: Format) => {
    const findings: Finding[] = [];
    for (const tool of tools) {
      if (!tool.accepts(format)) continue;
      try {
        findings.push(...(await tool.inspect(bytes, format)));
      } catch {
        // 檢查失敗不影響加入暫存區，清除時會再遇到同樣的問題並停下來
      }
    }
    return findings;
  };

  const updateFile = (id: number, update: (file: TrayFile) => TrayFile) => {
    set({ files: state.files.map((f) => (f.id === id ? update(f) : f)) });
  };

  const addVersion = async (fileId: number, input: Blob, toolId: string, report?: Report) => {
    const data = new Uint8Array(await input.arrayBuffer());
    const format = sniff(data);
    const blob = new Blob([data], { type: MIME[format] });
    if (verify) await verify(blob, format);
    const version: Version = { id: nextId++, tool: toolId, blob, format, findings: await inspect(data, format), report };
    updateFile(fileId, (f) => ({ ...f, versions: [...f.versions, version] }));
  };

  return {
    get: () => state,

    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // origin 是產生這些檔案的工具（例如 QR code 產生器），讀者自己加入的檔案不帶
    async add(files: File[], origin: string | null = null) {
      const added: TrayFile[] = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const format = sniff(bytes);
        added.push({
          id: nextId++,
          name: file.name,
          versions: [{ id: nextId++, tool: origin, blob: file, format, findings: await inspect(bytes, format) }],
        });
      }
      if (!added.length) return;
      set({ files: [...state.files, ...added], selected: added[0]!.id });
    },

    select(id: number | null) {
      set({ selected: id });
    },

    remove(id: number) {
      const files = state.files.filter((f) => f.id !== id);
      set({ files, selected: state.selected === id ? (files[0]?.id ?? null) : state.selected });
    },

    clear() {
      set({ files: [], selected: null });
    },

    async apply(fileId: number, tool: Tool) {
      const current = state.files.find((f) => f.id === fileId)?.versions.at(-1);
      if (!current) return;
      if (!tool.accepts(current.format)) throw new ToolError("unsupported");
      set({ busy: true });
      try {
        const input = new Uint8Array(await current.blob.arrayBuffer());
        const { data, report } = await tool.run(input, current.format);
        await addVersion(fileId, new Blob([data as Uint8Array<ArrayBuffer>]), tool.id, report);
      } finally {
        set({ busy: false });
      }
    },

    // 編輯畫面產生的結果也走這裡：先實際解碼一次，再當成新版本加在檔案底下
    addVersion: (fileId: number, blob: Blob, toolId: string, report?: Report) => addVersion(fileId, blob, toolId, report),

    undo(fileId: number) {
      updateFile(fileId, (f) => (f.versions.length > 1 ? { ...f, versions: f.versions.slice(0, -1) } : f));
    },
  };
}

export type Tray = ReturnType<typeof createTray>;
