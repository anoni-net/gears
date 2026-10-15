import { u32le } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { type Inner, Tally } from "./package.ts";

// gzip（.gz、.tar.gz、.tgz）：標頭記著壓縮前的檔名、修改時間與作業系統，還可以有註解。
// 解壓縮之後交給裡面那個格式的處理程式（最常見的是 TAR），再重新壓縮，標頭只留必要的欄位。

const MAX_SIZE = 512 * 1024 * 1024;

interface Header {
  flags: number;
  mtime: number;
  name?: string;
  comment?: string;
}

function header(bytes: Uint8Array): Header {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) throw new ToolError("broken");
  const flags = bytes[3]!;
  let at = 10;
  if (flags & 4) at += 2 + (bytes[at]! | (bytes[at + 1]! << 8));
  const text = () => {
    const end = bytes.indexOf(0, at);
    if (end < 0) throw new ToolError("broken");
    const value = new TextDecoder("latin1").decode(bytes.subarray(at, end));
    at = end + 1;
    return value;
  };
  const name = flags & 8 ? text() : undefined;
  const comment = flags & 16 ? text() : undefined;
  return { flags, mtime: u32le(bytes, 4), name, comment };
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  // 檔尾記著解壓縮後的大小（除以 2^32 的餘數），太大的先擋下來
  if (u32le(bytes, bytes.length - 4) > MAX_SIZE) throw new ToolError("unsupported");
  try {
    return await pipe(bytes, new DecompressionStream("gzip"));
  } catch {
    throw new ToolError("broken");
  }
}

export async function stripGzip(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const head = header(bytes);
  const data = await gunzip(bytes);
  const result = await inner.strip(data);
  const tally = new Tally();
  if (head.name !== undefined || head.comment !== undefined || head.mtime || head.flags & 4) tally.add("archive-info");
  if (result) tally.merge(result.report.removed);
  const out = await pipe(result ? result.data : data, new CompressionStream("gzip"));
  // 修改時間清成零，作業系統寫成「不明」，各家瀏覽器的輸出才會一致
  out.fill(0, 4, 9);
  out[9] = 255;
  return { data: out, report: { removed: tally.items(), kept: [{ code: "archive-content" }] } };
}

export async function inspectGzip(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const head = header(bytes);
  const findings: Finding[] = [];
  if (head.name) findings.push({ code: "text", value: head.name.slice(0, 80) });
  if (head.comment) findings.push({ code: "comment", value: head.comment.slice(0, 80) });
  if (head.mtime) findings.push({ code: "datetime", value: new Date(head.mtime * 1000).toISOString().replace("T", " ").slice(0, 19) });
  findings.push(...((await inner.inspect(await gunzip(bytes))) ?? []));
  return findings;
}
