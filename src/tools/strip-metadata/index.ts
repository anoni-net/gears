import type { Format } from "../../core/bytes.ts";
import { FINDING_CODES, type Finding, type RunResult, type Tool, ToolError, mergeFindings } from "../../core/tool.ts";
import { inspectJpeg, stripJpeg } from "./jpeg.ts";
import { inspectPng, stripPng } from "./png.ts";

export const stripMetadata: Tool = {
  id: "strip-metadata",
  resolves: FINDING_CODES,

  accepts(format: Format) {
    return format === "jpeg" || format === "png";
  },

  inspect(data: Uint8Array, format: Format): Finding[] {
    if (format === "jpeg") return mergeFindings(inspectJpeg(data));
    if (format === "png") return mergeFindings(inspectPng(data));
    return [];
  },

  run(data: Uint8Array, format: Format): RunResult {
    if (format === "jpeg") return stripJpeg(data);
    if (format === "png") return stripPng(data);
    throw new ToolError("unsupported");
  },
};
