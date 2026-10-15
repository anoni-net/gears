import { type Format, MIME, sniff } from "./bytes.ts";
import { type Finding, LARGE_FILE, type Report, type Tool, ToolError } from "./tool.ts";

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
  large: boolean; // 太大、沒有整個讀進記憶體，只能交給支援大檔案的工具（見 LARGE_FILE）
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
  failed: string[]; // 沒有辦法讀取的檔名，例如超過瀏覽器記憶體上限的檔案
}

// 處理完的檔案交出去之前先實際解碼一次，改壞的檔案不會出現在暫存區。
export type Verifier = (blob: Blob, format: Format) => Promise<void>;

type Listener = () => void;

export function createTray(tools: Tool[], verify?: Verifier) {
  let state: TrayState = { files: [], selected: null, busy: false, failed: [] };
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

  // 大檔案只讀開頭判斷格式，交給支援大檔案的工具檢查
  const read = async (blob: Blob): Promise<{ format: Format; findings: Finding[]; large: boolean }> => {
    if (blob.size > LARGE_FILE) {
      const format = sniff(new Uint8Array(await blob.slice(0, 65536).arrayBuffer()));
      const findings: Finding[] = [];
      for (const tool of tools) {
        if (!tool.acceptsLarge?.(format) || !tool.inspectLarge) continue;
        try {
          findings.push(...(await tool.inspectLarge(blob, format)));
        } catch {
          // 同上，清除時會再遇到
        }
      }
      return { format, findings, large: true };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const format = sniff(bytes);
    return { format, findings: await inspect(bytes, format), large: false };
  };

  const updateFile = (id: number, update: (file: TrayFile) => TrayFile) => {
    set({ files: state.files.map((f) => (f.id === id ? update(f) : f)) });
  };

  const addVersion = async (fileId: number, input: Blob, toolId: string, report?: Report) => {
    const { format, findings, large } = await read(input);
    const blob = new Blob([input], { type: MIME[format] });
    if (verify && !large) await verify(blob, format);
    const version: Version = { id: nextId++, tool: toolId, blob, format, findings, report, large };
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
      const failed: string[] = [];
      set({ busy: true, failed: [] });
      try {
        for (const file of files) {
          try {
            const { format, findings, large } = await read(file);
            added.push({ id: nextId++, name: file.name, versions: [{ id: nextId++, tool: origin, blob: file, format, findings, large }] });
          } catch {
            failed.push(file.name);
          }
        }
      } finally {
        set({ busy: false, failed });
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
      set({ files: [], selected: null, failed: [] });
    },

    async apply(fileId: number, tool: Tool) {
      const current = state.files.find((f) => f.id === fileId)?.versions.at(-1);
      if (!current) return;
      const large = current.large;
      if (large ? !tool.acceptsLarge?.(current.format) || !tool.runLarge : !tool.accepts(current.format)) throw new ToolError("unsupported");
      set({ busy: true });
      try {
        if (large) {
          const { blob, report } = await tool.runLarge!(current.blob, current.format);
          await addVersion(fileId, blob, tool.id, report);
          return;
        }
        const input = new Uint8Array(await current.blob.arrayBuffer());
        const { data, report } = await tool.run(input, current.format);
        await addVersion(fileId, new Blob([data as Uint8Array<ArrayBuffer>]), tool.id, report);
      } finally {
        set({ busy: false });
      }
    },

    // 這個工具能處理目前這個版本，而且檔案裡有它能處理的資訊
    needs(tool: Tool, version: Version): boolean {
      const usable = version.large ? !!tool.acceptsLarge?.(version.format) : tool.accepts(version.format);
      return usable && version.findings.some((f) => tool.resolves.includes(f.code));
    },

    // 一次處理暫存區裡所有需要處理的檔案。逐一處理，一個失敗不影響其他的
    async applyAll(tool: Tool, onProgress?: (done: number, total: number) => void): Promise<{ done: number; failed: string[] }> {
      const targets = state.files.filter((f) => this.needs(tool, f.versions.at(-1)!));
      const failed: string[] = [];
      let done = 0;
      for (const [i, file] of targets.entries()) {
        onProgress?.(i, targets.length);
        try {
          await this.apply(file.id, tool);
          done++;
        } catch {
          failed.push(file.name);
        }
      }
      onProgress?.(targets.length, targets.length);
      return { done, failed };
    },

    // 編輯畫面產生的結果也走這裡：先實際解碼一次，再當成新版本加在檔案底下
    addVersion: (fileId: number, blob: Blob, toolId: string, report?: Report) => addVersion(fileId, blob, toolId, report),

    undo(fileId: number) {
      updateFile(fileId, (f) => (f.versions.length > 1 ? { ...f, versions: f.versions.slice(0, -1) } : f));
    },
  };
}

export type Tray = ReturnType<typeof createTray>;
