import { ascii, type Format, indexOf, startsWith, u32be, u32le } from "../../core/bytes.ts";
import { unescapeXml, walkXml } from "../../core/xml.ts";
import type { C2paCheck } from "./c2pa.ts";

// 來源標示：檔案自己宣告的產生方式。IPTC 的數位來源類型與 AI 欄位、GB 45438 的隱式標識、
// 生成工具寫下的參數，以及有沒有 C2PA 內容憑證。只讀檔案寫了什麼，不從像素推算任何分數。
// 除了 C2PA，這些標示都沒有簽章，誰都能寫入或修改。C2PA 這一版只辨識有沒有，還不驗證簽章
// （anoni-net/gears#127）。

export const IPTC_EXT = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/";
export const TC260 = "http://www.tc260.org.cn/ns/AIGC/1.0/";

export type GeneratorTool = "a1111" | "comfyui" | "novelai";

export interface Generator {
  tool: GeneratorTool;
  model?: string;
  prompt?: string;
}

// GB 45438 的隱式標識寫在哪裡：XMP 的 TC260:AIGC、EXIF 的 UserComment，或 PNG 關鍵字為 AIGC 的 tEXt
export type Tc260Where = "xmp" | "exif" | "png";

export interface Tc260Label {
  where: Tc260Where;
  label?: string;
  producer?: string;
  produceId?: string;
  propagator?: string;
  propagateId?: string;
  // 預留欄位 1、2 有內容：生成服務或轉傳平台寫了安全防護資訊（簽章與雜湊），這一版還不驗證
  security: ("producer" | "propagator")[];
}

export interface Provenance {
  digitalSource?: string; // IPTC 數位來源類型的代碼，網址的最後一段，例如 trainedAlgorithmicMedia
  aiSystem?: string;
  aiVersion?: string;
  prompt?: string;
  promptWriter?: string;
  generators: Generator[];
  tc260: Tc260Label[];
  c2pa: boolean;
  // 內容憑證的完整驗證（第二階段，src/ui/c2pa-check.ts），在瀏覽器裡由查證的畫面補上
  c2paCheck?: { check: C2paCheck } | { error: "wasm-unavailable" | "unreadable" };
}

// IPTC 數位來源類型的詞彙（cv.iptc.org/newscodes/digitalsourcetype，含已退役的三個），畫面上換成讀得懂的說法
export const DIGITAL_SOURCE_TYPES = [
  "digitalCapture", "computationalCapture", "negativeFilm", "positiveFilm", "print", "minorHumanEdits", "humanEdits",
  "compositeWithTrainedAlgorithmicMedia", "algorithmicallyEnhanced", "softwareImage", "digitalArt", "digitalCreation",
  "dataDrivenMedia", "trainedAlgorithmicMedia", "algorithmicMedia", "screenCapture", "virtualRecording", "composite",
  "compositeCapture", "compositeSynthetic",
] as const;

export const GENERATOR_TOOLS: readonly GeneratorTool[] = ["a1111", "comfyui", "novelai"];

export const emptyProvenance = (): Provenance => ({ generators: [], tc260: [], c2pa: false });

const MAX = 4000; // 提示詞可能很長，ComfyUI 的 workflow 更是整份 JSON

const clip = (text: string | undefined) => {
  const t = text?.trim();
  return t ? t.slice(0, MAX) : undefined;
};

// --- GB 45438 ---

// 值依 GB 45438 附錄 E 是一段 JSON。XMP 寫的是物件本身，EXIF 與 PNG 的替代寫法外面多包一層 {"AIGC":{…}}
export function parseTc260(text: string, where: Tc260Where): Tc260Label | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
    if (typeof value === "string") value = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (value && typeof value === "object" && "AIGC" in value) value = (value as { AIGC: unknown }).AIGC;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const field = (key: string) => {
    const v = o[key];
    if (typeof v === "number") return String(v);
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
  };
  const filled = (key: string) => {
    const v = o[key];
    return (typeof v === "string" && v.trim() !== "") || (!!v && typeof v === "object");
  };
  const label: Tc260Label = {
    where,
    label: field("Label"),
    producer: field("ContentProducer"),
    produceId: field("ProduceID"),
    propagator: field("ContentPropagator"),
    propagateId: field("PropagateID"),
    security: [],
  };
  if (filled("ReservedCode1")) label.security.push("producer");
  if (filled("ReservedCode2")) label.security.push("propagator");
  if (!label.label && !label.producer && !label.produceId && !label.propagator) return undefined;
  return label;
}

// XMP 裡的 TC260:AIGC，寫成屬性或元素都認得。清除中繼資料檢查時用，查證另外在讀 XMP 時一起讀
export function tc260InXmp(xmp: string): Tc260Label[] {
  const out: Tc260Label[] = [];
  try {
    walkXml(xmp, (el, text) => {
      if (text === null) {
        for (const a of el.attrs) if (a.ns === TC260 && a.local === "AIGC") push(parseTc260(unescapeXml(a.value), "xmp"));
      } else if (el.ns === TC260 && el.local === "AIGC") push(parseTc260(text, "xmp"));
    });
  } catch {
    // 讀不完整的 XMP 就停在讀到的部分
  }
  return out;
  function push(label: Tc260Label | undefined) {
    if (label) out.push(label);
  }
}

export type ProviderSubject = "organization" | "person";
export type ProviderBinding = "credit-code" | "id-number" | "phone" | "passport" | "net-id";

export interface ProviderCode {
  subject: ProviderSubject;
  binding: ProviderBinding;
  number: string;
  service?: "generation" | "propagation";
  model?: string;
}

// 服務提供者編碼（TC260-PG-20252A）：27 碼，格式版本 2 碼（00）、主體類型 1 碼、綁定方式 1 碼、
// 號碼 18 碼、服務擴展碼 5 碼。個人的號碼是身分證號、手機號碼、護照號碼或網號，以明文寫在編碼裡，
// 不足 18 碼的後面補 0
const PERSON: Record<string, [ProviderBinding, number]> = { "1": ["id-number", 18], "2": ["phone", 11], "3": ["passport", 9], "4": ["net-id", 10] };

export function parseProviderCode(code: string): ProviderCode | undefined {
  const m = /^00([12])([1-4])([0-9A-Z]{18})([0-9A-Z]{5})$/.exec(code.trim());
  if (!m) return undefined;
  const [, subject, binding, number, ext] = m as unknown as [string, string, string, string, string];
  let result: ProviderCode;
  if (subject === "1") {
    if (binding !== "1") return undefined;
    result = { subject: "organization", binding: "credit-code", number };
  } else {
    const [kind, length] = PERSON[binding]!;
    if (!/^0*$/.test(number.slice(length))) return undefined;
    result = { subject: "person", binding: kind, number: number.slice(0, length) };
  }
  if (ext !== "00000") {
    if (ext[0] === "1") result.service = "generation";
    else if (ext[0] === "2") result.service = "propagation";
    result.model = ext.slice(1);
  }
  return result;
}

// --- 生成工具的參數 ---

// Stable Diffusion WebUI（AUTOMATIC1111、Forge 這一系）：提示詞、Negative prompt: …，最後一行是
// 「Steps: 20, Sampler: …, Model: …」。寫在 PNG 的 parameters，JPEG 與 WebP 寫在 EXIF 的 UserComment
export function parseA1111(text: string): Generator | undefined {
  const at = text.startsWith("Steps: ") ? 0 : text.lastIndexOf("\nSteps: ");
  if (at < 0) return undefined;
  const head = text.slice(0, at);
  const negative = head.indexOf("Negative prompt:");
  const prompt = clip(negative >= 0 ? head.slice(0, negative) : head);
  const model = /(?:^|, )Model: ([^,\n]+)/.exec(text.slice(at).trim())?.[1]?.trim();
  return { tool: "a1111", model: model?.slice(0, 200), prompt };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const LOADER = /CheckpointLoader|UNETLoader|UnetLoader|DiffusionModelLoader/i;

// ComfyUI：prompt 是 API 格式（節點 id 對到 class_type 與 inputs），workflow 是畫面上的格式
// （nodes 陣列，值放在 widgets_values）。兩者通常同時存在，先讀 prompt
export function parseComfy(prompt?: string, workflow?: string): Generator {
  const out: Generator = { tool: "comfyui" };
  const parse = (text?: string): unknown => {
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  };
  const api = parse(prompt);
  if (isObject(api)) {
    for (const node of Object.values(api)) {
      if (!isObject(node) || !isObject(node.inputs)) continue;
      const type = String(node.class_type ?? "");
      const inputs = node.inputs;
      if (!out.model && LOADER.test(type)) {
        const name = inputs.ckpt_name ?? inputs.unet_name ?? inputs.model_name;
        if (typeof name === "string") out.model = name.slice(0, 200);
      }
      if (!out.prompt && type.startsWith("CLIPTextEncode") && typeof inputs.text === "string") out.prompt = clip(inputs.text);
    }
  }
  const ui = parse(workflow);
  if (isObject(ui) && Array.isArray(ui.nodes)) {
    for (const node of ui.nodes) {
      if (!isObject(node) || !Array.isArray(node.widgets_values)) continue;
      const type = String(node.type ?? "");
      const first = node.widgets_values[0];
      if (typeof first !== "string") continue;
      if (!out.model && LOADER.test(type)) out.model = first.slice(0, 200);
      if (!out.prompt && type.startsWith("CLIPTextEncode")) out.prompt = clip(first);
    }
  }
  return out;
}

export interface PngText {
  keyword: string;
  text: string;
}

// PNG 文字欄位裡的生成參數與 GB 45438 的隱式標識
export function fromPngTexts(entries: PngText[]): { generators: Generator[]; tc260: Tc260Label[] } {
  const get = (keyword: string) => entries.find((e) => e.keyword === keyword)?.text;
  const generators: Generator[] = [];
  const params = get("parameters");
  const a1111 = params ? parseA1111(params) : undefined;
  if (a1111) generators.push(a1111);
  if (get("prompt") || get("workflow")) {
    const comfy = parseComfy(get("prompt"), get("workflow"));
    if (comfy.model || comfy.prompt || get("workflow")) generators.push(comfy);
  }
  if (get("Software")?.trim() === "NovelAI") {
    let prompt = get("Description");
    try {
      const comment: unknown = JSON.parse(get("Comment") ?? "");
      if (!prompt && isObject(comment) && typeof comment.prompt === "string") prompt = comment.prompt;
    } catch {
      // Comment 不是 JSON 就只用 Description
    }
    generators.push({ tool: "novelai", model: get("Source")?.trim().slice(0, 200) || undefined, prompt: clip(prompt) });
  }
  const tc260: Tc260Label[] = [];
  for (const e of entries) {
    if (e.keyword !== "AIGC") continue;
    const label = parseTc260(e.text, "png");
    if (label) tc260.push(label);
  }
  return { generators, tc260 };
}

async function inflate(data: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out.length <= 4 * 1024 * 1024 ? out : undefined;
  } catch {
    return undefined;
  }
}

// PNG 的 tEXt（latin1）、zTXt（壓縮的 latin1）與 iTXt（UTF-8，可能壓縮）。XMP 由查證另外搜尋
export async function pngTexts(bytes: Uint8Array): Promise<PngText[]> {
  const out: PngText[] = [];
  const latin1 = new TextDecoder("latin1");
  const utf8 = new TextDecoder();
  let i = 8;
  while (i + 12 <= bytes.length && out.length < 64) {
    const length = u32be(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    const data = bytes.subarray(i + 8, Math.min(bytes.length, i + 8 + length));
    i += 12 + length;
    if (type === "IEND") break;
    if (type !== "tEXt" && type !== "zTXt" && type !== "iTXt") continue;
    const zero = data.indexOf(0);
    if (zero <= 0 || zero > 79) continue;
    const keyword = latin1.decode(data.subarray(0, zero));
    if (keyword === "XML:com.adobe.xmp") continue;
    let text: string | undefined;
    if (type === "tEXt") text = latin1.decode(data.subarray(zero + 1));
    else if (type === "zTXt") {
      const raw = await inflate(data.subarray(zero + 2));
      text = raw && latin1.decode(raw);
    } else {
      const compressed = data[zero + 1] === 1;
      let at = zero + 3;
      for (let skip = 0; skip < 2; skip++) {
        const end = data.indexOf(0, at);
        if (end < 0) {
          at = -1;
          break;
        }
        at = end + 1;
      }
      if (at < 0) continue;
      const body = data.subarray(at);
      const raw = compressed ? await inflate(body) : body;
      text = raw && utf8.decode(raw);
    }
    if (text !== undefined) out.push({ keyword, text });
  }
  return out;
}

// --- C2PA：只辨識有沒有內容憑證，位置照 C2PA 規範與官方的 c2pa-rs ---

export const C2PA_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81];

// at 是一個 jumb box 的開頭：裡面第一個 jumd 的類型以 c2pa 開頭
export const isC2paJumbf = (bytes: Uint8Array, at: number) => startsWith(bytes, at + 4, "jumb") && startsWith(bytes, at + 12, "jumd") && startsWith(bytes, at + 16, "c2pa");

// APP11 的內容（marker 與長度之後）：CI（JP）、En、Z 共 8 個位元組，接著是 jumb box
export const isC2paApp11 = (bytes: Uint8Array, body: number, end: number) => end - body >= 28 && startsWith(bytes, body, "JP") && isC2paJumbf(bytes, body + 8);

// 最上層的 uuid box，payload 的開頭是 C2PA 的 UUID
export const isC2paUuid = (bytes: Uint8Array, payload: number) => C2PA_UUID.every((b, k) => bytes[payload + k] === b);

// JPEG：APP11 的內容是 CI（JP）、En、Z，接著 JUMBF 的 jumb box，裡面第一個 jumd 的類型以 c2pa 開頭
function jpegC2pa(bytes: Uint8Array): boolean {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return false;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return false;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const body = i + 4;
    if (marker === 0xeb && isC2paApp11(bytes, body, i + 2 + length)) return true;
    i += 2 + length;
  }
  return false;
}

function pngC2pa(bytes: Uint8Array): boolean {
  let i = 8;
  while (i + 12 <= bytes.length) {
    const type = ascii(bytes, i + 4, 4);
    if (type === "caBX") return true;
    if (type === "IEND") return false;
    i += 12 + u32be(bytes, i);
  }
  return false;
}

// WebP、WAV、AVI：RIFF 最上層的 C2PA chunk
function riffC2pa(bytes: Uint8Array): boolean {
  let i = 12;
  while (i + 8 <= bytes.length) {
    if (ascii(bytes, i, 4) === "C2PA") return true;
    const size = u32le(bytes, i + 4);
    i += 8 + size + (size % 2);
  }
  return false;
}

// HEIF、AVIF、MP4、MOV、M4A：最上層、類型是 C2PA 的 uuid box
function bmffC2pa(bytes: Uint8Array): boolean {
  let i = 0;
  while (i + 8 <= bytes.length) {
    let size = u32be(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    let header = 8;
    if (size === 1) {
      if (i + 16 > bytes.length) return false;
      size = u32be(bytes, i + 8) * 2 ** 32 + u32be(bytes, i + 12);
      header = 16;
    } else if (size === 0) size = bytes.length - i;
    if (size < header) return false;
    if (type === "uuid" && isC2paUuid(bytes, i + header)) return true;
    i += size;
  }
  return false;
}

// JPEG XL：容器裡的 jumb box。用 brotli 壓縮過的（brob）讀不到裡面的標籤，不算
function jxlC2pa(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, 4, "JXL ")) return false;
  let i = 0;
  while (i + 8 <= bytes.length) {
    const size = u32be(bytes, i);
    if (isC2paJumbf(bytes, i)) return true;
    if (size < 8) return false;
    i += size;
  }
  return false;
}

// TIFF：IFD0 的標籤 0xCD41
function tiffC2pa(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const little = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > bytes.length) return false;
  const count = view.getUint16(ifd, little);
  for (let k = 0; k < count && ifd + 2 + k * 12 + 2 <= bytes.length; k++) {
    if (view.getUint16(ifd + 2 + k * 12, little) === 0xcd41) return true;
  }
  return false;
}

// GIF：識別碼為 C2PA_GIF 的 Application Extension（0x21 0xFF 0x0B）
function gifC2pa(bytes: Uint8Array): boolean {
  for (let at = indexOf(bytes, "C2PA_GIF"); at >= 0; at = indexOf(bytes, "C2PA_GIF", at + 1)) {
    if (at >= 3 && bytes[at - 3] === 0x21 && bytes[at - 2] === 0xff && bytes[at - 1] === 0x0b) return true;
  }
  return false;
}

export function hasC2pa(bytes: Uint8Array, format: Format): boolean {
  try {
    switch (format) {
      case "jpeg":
        return jpegC2pa(bytes);
      case "png":
        return pngC2pa(bytes);
      case "webp":
      case "wav":
      case "avi":
        return riffC2pa(bytes);
      case "heic":
      case "avif":
      case "mp4":
      case "mov":
      case "m4a":
        return bmffC2pa(bytes);
      case "jxl":
        return jxlC2pa(bytes);
      case "tiff":
        return tiffC2pa(bytes);
      case "gif":
        return gifC2pa(bytes);
      default:
        return false;
    }
  } catch {
    return false;
  }
}
