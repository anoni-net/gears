import { type Format, sniff } from "../../core/bytes.ts";
import { CONTENT_FINDINGS, FINDING_CODES, type Finding, type RunResult, type Tool, ToolError, mergeFindings } from "../../core/tool.ts";
import { inspectBmp, stripBmp } from "./bmp.ts";
import { inspectGif, stripGif } from "./gif.ts";
import { inspectHeif, stripHeif } from "./heif.ts";
import { inspectJpeg, stripJpeg } from "./jpeg.ts";
import { inspectJxl, stripJxl } from "./jxl.ts";
import { inspectOdf, stripOdf } from "./odf.ts";
import { inspectOoxml, stripOoxml } from "./ooxml.ts";
import type { Inner } from "./package.ts";
import { inspectPdf, stripPdf } from "./pdf.ts";
import { inspectEbml, stripEbml } from "./ebml.ts";
import { inspectFlac, stripFlac } from "./flac.ts";
import { inspectMp3, stripMp3 } from "./mp3.ts";
import { inspectMp4, stripMp4 } from "./mp4.ts";
import { inspectOgg, stripOgg } from "./ogg.ts";
import { inspectRiff, stripRiff } from "./riff.ts";
import { inspectPng, stripPng } from "./png.ts";
import { inspectPnm, stripPnm } from "./pnm.ts";
import { inspectSvg, stripSvg } from "./svg.ts";
import { inspectTiff, stripTiff } from "./tiff.ts";
import { inspectWebp, stripWebp } from "./webp.ts";

// 各格式的檢查與清除。格式的範圍參考 mat2（Tails 的 Metadata Cleaner 背後的工具）
type Handler = {
  inspect(data: Uint8Array, inner: Inner): Finding[] | Promise<Finding[]>;
  strip(data: Uint8Array, inner: Inner): RunResult | Promise<RunResult>;
};

const OOXML: Handler = { inspect: inspectOoxml, strip: stripOoxml };
const ODF: Handler = { inspect: inspectOdf, strip: stripOdf };
const MP4: Handler = { inspect: inspectMp4, strip: stripMp4 };
const RIFF: Handler = { inspect: inspectRiff, strip: stripRiff };
const OGG: Handler = { inspect: inspectOgg, strip: stripOgg };
const EBML: Handler = { inspect: inspectEbml, strip: stripEbml };

const HANDLERS: Partial<Record<Format, Handler>> = {
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
  docx: OOXML,
  xlsx: OOXML,
  pptx: OOXML,
  odt: ODF,
  ods: ODF,
  odp: ODF,
  odg: ODF,
  pdf: { inspect: inspectPdf, strip: stripPdf },
  mp3: { inspect: inspectMp3, strip: stripMp3 },
  m4a: MP4,
  mp4: MP4,
  mov: MP4,
  wav: RIFF,
  avi: RIFF,
  flac: { inspect: inspectFlac, strip: stripFlac },
  ogg: OGG,
  opus: OGG,
  mkv: EBML,
  webm: EBML,
};

// 文件裡的圖片與內嵌的文件交回這裡處理。內嵌的層數有上限，避免刻意做成的檔案無限遞迴
const MAX_DEPTH = 3;

function inner(depth: number): Inner {
  const handler = (data: Uint8Array) => {
    if (depth >= MAX_DEPTH) throw new ToolError("unsupported");
    const format = sniff(data);
    return HANDLERS[format] ? { handler: HANDLERS[format], format } : null;
  };
  return {
    async inspect(data) {
      const found = handler(data);
      return found ? found.handler.inspect(data, inner(depth + 1)) : null;
    },
    async strip(data) {
      const found = handler(data);
      return found ? found.handler.strip(data, inner(depth + 1)) : null;
    },
  };
}

export const STRIP_FORMATS = Object.keys(HANDLERS) as Format[];

export const stripMetadata: Tool = {
  id: "strip-metadata",
  resolves: FINDING_CODES.filter((code) => !CONTENT_FINDINGS.includes(code)),

  accepts(format: Format) {
    return format in HANDLERS;
  },

  async inspect(data: Uint8Array, format: Format): Promise<Finding[]> {
    const handler = HANDLERS[format];
    return handler ? mergeFindings(await handler.inspect(data, inner(0))) : [];
  },

  async run(data: Uint8Array, format: Format): Promise<RunResult> {
    const handler = HANDLERS[format];
    if (!handler) throw new ToolError("unsupported");
    return handler.strip(data, inner(0));
  },
};
