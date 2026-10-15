import type { Format } from "../../core/bytes.ts";
import { FINDING_CODES, type Finding, type RunResult, type Tool, ToolError, mergeFindings } from "../../core/tool.ts";
import { inspectBmp, stripBmp } from "./bmp.ts";
import { inspectGif, stripGif } from "./gif.ts";
import { inspectHeif, stripHeif } from "./heif.ts";
import { inspectJpeg, stripJpeg } from "./jpeg.ts";
import { inspectJxl, stripJxl } from "./jxl.ts";
import { inspectPng, stripPng } from "./png.ts";
import { inspectPnm, stripPnm } from "./pnm.ts";
import { inspectSvg, stripSvg } from "./svg.ts";
import { inspectTiff, stripTiff } from "./tiff.ts";
import { inspectWebp, stripWebp } from "./webp.ts";

// 各格式的檢查與清除。格式的範圍參考 mat2（Tails 的 Metadata Cleaner 背後的工具）
const HANDLERS: Partial<Record<Format, { inspect(data: Uint8Array): Finding[]; strip(data: Uint8Array): RunResult }>> = {
  jpeg: { inspect: inspectJpeg, strip: stripJpeg },
  png: { inspect: inspectPng, strip: stripPng },
  heic: { inspect: inspectHeif, strip: stripHeif },
  avif: { inspect: inspectHeif, strip: stripHeif },
  gif: { inspect: inspectGif, strip: stripGif },
  webp: { inspect: inspectWebp, strip: stripWebp },
  tiff: { inspect: inspectTiff, strip: stripTiff },
  bmp: { inspect: inspectBmp, strip: stripBmp },
  pnm: { inspect: inspectPnm, strip: stripPnm },
  svg: { inspect: inspectSvg, strip: stripSvg },
  jxl: { inspect: inspectJxl, strip: stripJxl },
};

export const STRIP_FORMATS = Object.keys(HANDLERS) as Format[];

export const stripMetadata: Tool = {
  id: "strip-metadata",
  resolves: FINDING_CODES,

  accepts(format: Format) {
    return format in HANDLERS;
  },

  inspect(data: Uint8Array, format: Format): Finding[] {
    const handler = HANDLERS[format];
    return handler ? mergeFindings(handler.inspect(data)) : [];
  },

  run(data: Uint8Array, format: Format): RunResult {
    const handler = HANDLERS[format];
    if (!handler) throw new ToolError("unsupported");
    return handler.strip(data);
  },
};
