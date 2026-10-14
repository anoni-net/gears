import type { Tool } from "../core/tool.ts";
import { stripMetadata } from "./strip-metadata/index.ts";

// 工作台上的所有工具。新增工具時加在這裡，暫存區與介面不必改。
export const tools: Tool[] = [stripMetadata];

export { stripMetadata };
