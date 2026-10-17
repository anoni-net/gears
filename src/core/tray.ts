import { type Format, MIME, sniff } from "./bytes.ts";
import { type Finding, LARGE_FILE, type Report, type RunOptions, type Tool, ToolError } from "./tool.ts";

// 檔案暫存區。所有工具共用，每次處理產生一個新版本、原檔保留，可以退回上一步。
//
// 只放在這個分頁的記憶體裡，不寫進 localStorage、IndexedDB 或任何儲存空間。
// 關掉分頁就消失，「清空」把所有參照放掉，交給瀏覽器回收。換上新版本時由 service worker
// 在記憶體裡暫放一下，重新載入之後拿回來（snapshot、restore，見 src/ui/offline.ts）。

export interface Version {
  id: number;
  tool: string | null; // 產生這個版本的工具，null 是讀者加入的原檔
  blob: Blob;
  format: Format;
  findings: Finding[];
  report?: Report;
  large: boolean; // 太大、沒有整個讀進記憶體，只能交給支援大檔案的工具（見 LARGE_FILE）
}

export type Intent = "handover" | "send" | "check";

export interface TrayFile {
  id: number;
  name: string;
  addedAt: number; // 加入暫存區的時間（裝置的時鐘），查證紀錄裡記下來
  // 讀者加入檔案時在做的事：從哪一組的任務或工具加入（交出去之前、安全地傳送、檢查收到的），
  // 檔案畫面的工具列表把那一組排在前面。從桌面直接加入的沒有
  intent?: Intent;

  versions: Version[];
}

// 換版本時交給 service worker 暫放的內容，只有資料與 Blob，可以用 postMessage 傳送
export interface TraySnapshot {
  files: TrayFile[];
  selected: number | null;
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

// 暫存區發生的事，介面層用來記錄使用統計（src/ui/analytics.ts）。只有工具 id、格式與失敗的原因，
// 不含檔名與內容
export interface TrayHooks {
  added?(formats: Format[], origin: string | null): void; // 加入暫存區的檔案，origin 同 add()
  unreadable?(count: number): void; // 加入時就讀不了的檔案
  versioned?(toolId: string): void; // 處理完成，產生了新版本
  failed?(toolId: string, error: unknown, large: boolean): void; // 處理失敗
}

export function createTray(tools: Tool[], verify?: Verifier, hooks: TrayHooks = {}) {
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

    // origin 是產生這些檔案的工具（例如 QR code 產生器），讀者自己加入的檔案不帶。
    // intent 見 TrayFile.intent
    async add(files: File[], origin: string | null = null, intent?: Intent) {
      const added: TrayFile[] = [];
      const failed: string[] = [];
      set({ busy: true, failed: [] });
      try {
        for (const file of files) {
          try {
            const { format, findings, large } = await read(file);
            added.push({
              id: nextId++,
              name: file.name,
              addedAt: Date.now(),
              ...(intent ? { intent } : {}),
              versions: [{ id: nextId++, tool: origin, blob: file, format, findings, large }],
            });
          } catch {
            failed.push(file.name);
          }
        }
      } finally {
        set({ busy: false, failed });
      }
      if (failed.length) hooks.unreadable?.(failed.length);
      if (!added.length) return;
      set({ files: [...state.files, ...added], selected: added[0]!.id });
      hooks.added?.(
        added.map((f) => f.versions[0]!.format),
        origin,
      );
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

    async apply(fileId: number, tool: Tool, options?: RunOptions) {
      const current = state.files.find((f) => f.id === fileId)?.versions.at(-1);
      if (!current) return;
      const large = current.large;
      if (large ? !tool.acceptsLarge?.(current.format) || !tool.runLarge : !tool.accepts(current.format)) {
        const error = new ToolError("unsupported");
        hooks.failed?.(tool.id, error, large);
        throw error;
      }
      set({ busy: true });
      try {
        if (large) {
          const { blob, report } = await tool.runLarge!(current.blob, current.format);
          await addVersion(fileId, blob, tool.id, report);
        } else {
          const input = new Uint8Array(await current.blob.arrayBuffer());
          const { data, report } = await tool.run(input, current.format, options);
          await addVersion(fileId, new Blob([data as Uint8Array<ArrayBuffer>]), tool.id, report);
        }
        hooks.versioned?.(tool.id);
      } catch (error) {
        hooks.failed?.(tool.id, error, large);
        throw error;
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
    async addVersion(fileId: number, blob: Blob, toolId: string, report?: Report) {
      try {
        await addVersion(fileId, blob, toolId, report);
      } catch (error) {
        hooks.failed?.(toolId, error, false);
        throw error;
      }
      hooks.versioned?.(toolId);
    },

    // 暫存區是空的時候回傳 null，沒有東西需要帶到新版本
    snapshot(): TraySnapshot | null {
      return state.files.length ? { files: state.files, selected: state.selected } : null;
    },

    // 重新載入之後放回來。編號接著最大的繼續，之後加入的檔案與版本不會撞號
    restore(snapshot: TraySnapshot) {
      const ids = snapshot.files.flatMap((f) => [f.id, ...f.versions.map((v) => v.id)]);
      nextId = Math.max(nextId, ...ids.map((id) => id + 1));
      set({ files: [...snapshot.files, ...state.files], selected: snapshot.selected ?? state.selected });
    },

    undo(fileId: number) {
      updateFile(fileId, (f) => (f.versions.length > 1 ? { ...f, versions: f.versions.slice(0, -1) } : f));
    },
  };
}

export type Tray = ReturnType<typeof createTray>;
