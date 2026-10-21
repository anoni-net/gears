import { expect, test } from "@playwright/test";
import { concat } from "../../src/core/bytes.ts";
import { zhTW } from "../../src/i18n/zh-TW.ts";
import { examine } from "../../src/tools/verify/examine.ts";
import {
  DIGITAL_SOURCE_TYPES,
  GENERATOR_TOOLS,
  fromPngTexts,
  hasC2pa,
  parseA1111,
  parseComfy,
  parseProviderCode,
  parseTc260,
} from "../../src/tools/verify/provenance.ts";
import { provenanceLines } from "../../src/ui/verify-report.ts";
import { buildTiff, bytes, chunk, exifSegment, heifBox, insertIntoPng, segment, syntheticJpeg, syntheticPng } from "../helpers/fixtures.ts";

// 編碼與號碼都是編出來的，不對應任何真實的組織或個人，也不沿用 TC260 指南裡的範例
const ORG = `0011${"9100000000TEST001X"}00000`;
const PERSON_PHONE = `0022${"19900001111"}${"0".repeat(7)}10042`;
const tc260Json = (producer: string) =>
  JSON.stringify({ Label: "1", ContentProducer: producer, ProduceID: "pid-test-0001", ReservedCode1: "", ContentPropagator: "", PropagateID: "", ReservedCode2: "" });

const C2PA_UUID = new Uint8Array([0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81]);

function minimalJpeg(...segments: Uint8Array[]): Uint8Array {
  return concat([new Uint8Array([0xff, 0xd8]), ...segments, segment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])), new Uint8Array([0x12, 0x34, 0xff, 0xd9])]);
}

function riff(form: string, ...chunks: [string, Uint8Array][]): Uint8Array {
  const parts = chunks.map(([id, data]) => {
    const head = concat([bytes(id), new Uint8Array(4)]);
    new DataView(head.buffer).setUint32(4, data.length, true);
    return concat([head, data, new Uint8Array(data.length % 2)]);
  });
  const body = concat([bytes(form), ...parts]);
  const head = concat([bytes("RIFF"), new Uint8Array(4)]);
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concat([head, body]);
}

// JUMBF 的 jumb box，裡面的 jumd 類型以 c2pa 開頭
const jumbf = () => heifBox("jumb", heifBox("jumd", bytes("c2pa"), new Uint8Array(12), new Uint8Array([3]), bytes("c2pa\0")), heifBox("json", bytes("{}")));

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([bytes(text)]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

test("服務提供者編碼：組織與個人，個人的號碼去掉補位的 0", () => {
  expect(parseProviderCode(ORG)).toEqual({ subject: "organization", binding: "credit-code", number: "9100000000TEST001X" });
  expect(parseProviderCode(PERSON_PHONE)).toEqual({ subject: "person", binding: "phone", number: "19900001111", service: "generation", model: "0042" });
  expect(parseProviderCode(`0024${"A1B2C3D4E5"}${"0".repeat(8)}20007`)).toMatchObject({ binding: "net-id", number: "A1B2C3D4E5", service: "propagation" });
  // 長度不對、組織綁的不是統一社會信用代碼、補位的地方不是 0，都不當成編碼
  expect(parseProviderCode(ORG.slice(1))).toBeUndefined();
  expect(parseProviderCode(`0012${"9100000000TEST001X"}00000`)).toBeUndefined();
  expect(parseProviderCode(`0022${"19900001111"}0000001${"00000"}`)).toBeUndefined();
});

test("GB 45438 的隱式標識：XMP 的物件、替代寫法多包的一層、數字的標示值與預留欄位", () => {
  expect(parseTc260(tc260Json(ORG), "xmp")).toEqual({ where: "xmp", label: "1", producer: ORG, produceId: "pid-test-0001", propagator: undefined, propagateId: undefined, security: [] });
  const wrapped = JSON.stringify({ AIGC: { Label: 2, ContentPropagator: ORG, PropagateID: "share-1", ReservedCode2: { SecurityData: { Type: "TC260PG", Version: 1 } } } });
  expect(parseTc260(wrapped, "png")).toMatchObject({ where: "png", label: "2", propagator: ORG, propagateId: "share-1", security: ["propagator"] });
  expect(parseTc260("not json", "exif")).toBeUndefined();
  expect(parseTc260(JSON.stringify({ Other: 1 }), "exif")).toBeUndefined();
});

test("Stable Diffusion WebUI 與 ComfyUI 的生成參數", () => {
  const params = "a lighthouse at dusk, oil painting\nNegative prompt: blurry\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 1, Size: 512x512, Model: test-model-v1, Version: v1.10";
  expect(parseA1111(params)).toEqual({ tool: "a1111", model: "test-model-v1", prompt: "a lighthouse at dusk, oil painting" });
  expect(parseA1111("just a caption")).toBeUndefined();

  const api = JSON.stringify({
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "test-checkpoint.safetensors" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat on a roof", clip: ["4", 1] } },
  });
  expect(parseComfy(api)).toEqual({ tool: "comfyui", model: "test-checkpoint.safetensors", prompt: "a cat on a roof" });
  const workflow = JSON.stringify({ nodes: [{ type: "UNETLoader", widgets_values: ["test-unet.safetensors", "default"] }, { type: "CLIPTextEncode", widgets_values: ["a dog"] }] });
  expect(parseComfy(undefined, workflow)).toEqual({ tool: "comfyui", model: "test-unet.safetensors", prompt: "a dog" });
});

test("PNG 文字欄位：NovelAI 與 GB 45438 的替代寫法", () => {
  const found = fromPngTexts([
    { keyword: "Software", text: "NovelAI" },
    { keyword: "Source", text: "Test Diffusion V9" },
    { keyword: "Comment", text: JSON.stringify({ prompt: "a red bicycle" }) },
    { keyword: "AIGC", text: JSON.stringify({ AIGC: JSON.parse(tc260Json(PERSON_PHONE)) }) },
  ]);
  expect(found.generators).toEqual([{ tool: "novelai", model: "Test Diffusion V9", prompt: "a red bicycle" }]);
  expect(found.tc260).toMatchObject([{ where: "png", label: "1", producer: PERSON_PHONE }]);
});

test("C2PA 內容憑證：各格式存放的位置", () => {
  const app11 = segment(0xeb, concat([bytes("JP"), new Uint8Array([0, 1, 0, 0, 0, 1]), jumbf()]));
  expect(hasC2pa(minimalJpeg(app11), "jpeg")).toBe(true);
  expect(hasC2pa(syntheticJpeg(), "jpeg")).toBe(false);
  // 掃描到影像資料就停，影像裡剛好出現的位元組不算
  expect(hasC2pa(concat([minimalJpeg(), app11]), "jpeg")).toBe(false);

  expect(hasC2pa(insertIntoPng(syntheticPng(), chunk("caBX", jumbf())), "png")).toBe(true);
  expect(hasC2pa(syntheticPng(), "png")).toBe(false);

  expect(hasC2pa(riff("WEBP", ["VP8L", bytes("FAKE")], ["C2PA", jumbf()]), "webp")).toBe(true);
  expect(hasC2pa(riff("WEBP", ["VP8L", bytes("FAKE")], ["XMP ", bytes("<x/>")]), "webp")).toBe(false);
  expect(hasC2pa(riff("WAVE", ["fmt ", new Uint8Array(16)], ["C2PA", jumbf()]), "wav")).toBe(true);

  const ftyp = heifBox("ftyp", bytes("heic"), new Uint8Array(4), bytes("mif1heic"));
  expect(hasC2pa(concat([ftyp, heifBox("uuid", C2PA_UUID, new Uint8Array(4), jumbf())]), "heic")).toBe(true);
  expect(hasC2pa(concat([ftyp, heifBox("uuid", new Uint8Array(16), jumbf())]), "heic")).toBe(false);
  expect(hasC2pa(concat([heifBox("ftyp", bytes("isom"), new Uint8Array(4)), heifBox("mdat", bytes("x")), heifBox("uuid", C2PA_UUID, jumbf())]), "mp4")).toBe(true);

  const jxl = concat([heifBox("JXL ", new Uint8Array([0x0d, 0x0a, 0x87, 0x0a])), heifBox("ftyp", bytes("jxl "), new Uint8Array(4), bytes("jxl ")), jumbf()]);
  expect(hasC2pa(jxl, "jxl")).toBe(true);

  const tiff = buildTiff({ ifd0: [{ tag: 256, type: 3, value: [1] }, { tag: 0xcd41, type: 7, value: jumbf() }] });
  expect(hasC2pa(tiff, "tiff")).toBe(true);
  expect(hasC2pa(buildTiff({ ifd0: [{ tag: 256, type: 3, value: [1] }] }), "tiff")).toBe(false);

  const gif = concat([bytes("GIF89a"), new Uint8Array([1, 0, 1, 0, 0, 0, 0]), new Uint8Array([0x21, 0xff, 11]), bytes("C2PA_GIF"), new Uint8Array([1, 0, 0, 0]), new Uint8Array([0x3b])]);
  expect(hasC2pa(gif, "gif")).toBe(true);
  expect(hasC2pa(bytes("GIF89a C2PA_GIF"), "gif")).toBe(false);
});

test("查證讀出 XMP 裡的 IPTC 欄位與 GB 45438 的隱式標識", async () => {
  const json = tc260Json(ORG).replaceAll('"', "&quot;");
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:TC260="http://www.tc260.org.cn/ns/AIGC/1.0/"' +
    ' Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"' +
    ` Iptc4xmpExt:AISystemUsed="Example Image Model" Iptc4xmpExt:AISystemVersionUsed="2.1" TC260:AIGC="${json}">` +
    "<Iptc4xmpExt:AIPromptInformation>a lighthouse at dusk</Iptc4xmpExt:AIPromptInformation>" +
    "<Iptc4xmpExt:AIPromptWriterName>Test Writer</Iptc4xmpExt:AIPromptWriterName>" +
    "</rdf:Description></rdf:RDF></x:xmpmeta>";
  const jpeg = minimalJpeg(segment(0xe1, bytes(`http://ns.adobe.com/xap/1.0/\0${xmp}`)));
  const ev = await examine(jpeg, "jpeg");
  expect(ev.provenance).toEqual({
    digitalSource: "trainedAlgorithmicMedia",
    aiSystem: "Example Image Model",
    aiVersion: "2.1",
    prompt: "a lighthouse at dusk",
    promptWriter: "Test Writer",
    generators: [],
    tc260: [{ where: "xmp", label: "1", producer: ORG, produceId: "pid-test-0001", propagator: undefined, propagateId: undefined, security: [] }],
    c2pa: false,
  });
  const lines = provenanceLines(ev);
  expect(lines).toContain(`IPTC 的數位來源類型：${zhTW["verify.dst.trainedAlgorithmicMedia"]}（trainedAlgorithmicMedia）`);
  expect(lines).toContain(`生成服務：組織，統一社會信用代碼 9100000000TEST001X（${ORG}）`);
});

test("查證讀出 EXIF 的 UserComment：GB 45438 的替代寫法與 WebUI 寫進 JPEG 的參數", async () => {
  const comment = (prefix: string, body: Uint8Array) => buildTiff({ ifd0: [{ tag: 0x010f, type: 2, value: "TestMaker" }], exif: [{ tag: 0x9286, type: 7, value: concat([bytes(prefix), body]) }] });
  const ascii = await examine(minimalJpeg(exifSegment(comment("ASCII\0\0\0", bytes(JSON.stringify({ AIGC: JSON.parse(tc260Json(PERSON_PHONE)) }))))), "jpeg");
  expect(ascii.provenance?.tc260).toMatchObject([{ where: "exif", label: "1", producer: PERSON_PHONE }]);
  // 個人的號碼照實列出，讀者看過之後再決定要不要清除中繼資料
  expect(provenanceLines(ascii)).toContain(`生成服務：個人，手機號碼 19900001111，生成合成服務，模型代碼 0042（${PERSON_PHONE}）`);

  // UTF-16 大端序，有些程式不管 TIFF 的位元組順序一律這樣寫
  const text = "a quiet street\nSteps: 30, Sampler: DPM++ 2M, Model: test-model-v2";
  const utf16 = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) utf16[i * 2 + 1] = text.charCodeAt(i);
  const unicode = await examine(minimalJpeg(exifSegment(comment("UNICODE\0", utf16))), "jpeg");
  expect(unicode.provenance?.generators).toEqual([{ tool: "a1111", model: "test-model-v2", prompt: "a quiet street" }]);
});

test("查證讀出 PNG 的生成參數、壓縮過的文字欄位與 C2PA", async () => {
  const comfy = JSON.stringify({ "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "test.safetensors" } } });
  const png = insertIntoPng(
    syntheticPng(),
    chunk("tEXt", bytes("parameters\0a garden\nSteps: 10, Model: garden-model")),
    chunk("zTXt", concat([bytes("prompt\0\0"), await deflate(comfy)])),
    chunk("tEXt", bytes(`AIGC\0${JSON.stringify({ AIGC: JSON.parse(tc260Json(ORG)) })}`)),
    chunk("caBX", jumbf()),
  );
  const ev = await examine(png, "png");
  expect(ev.provenance?.generators).toEqual([
    { tool: "a1111", model: "garden-model", prompt: "a garden" },
    { tool: "comfyui", model: "test.safetensors" },
  ]);
  expect(ev.provenance?.tc260).toMatchObject([{ where: "png", producer: ORG }]);
  expect(ev.provenance?.c2pa).toBe(true);
});

test("沒有來源標示的檔案沒有 provenance", async () => {
  expect((await examine(syntheticJpeg(), "jpeg")).provenance).toBeUndefined();
  expect((await examine(syntheticPng(), "png")).provenance).toBeUndefined();
});

test("來源標示用到的代碼都有正體中文的字串", () => {
  const keys = new Set(Object.keys(zhTW));
  const expected = [
    ...DIGITAL_SOURCE_TYPES.map((c) => `verify.dst.${c}`),
    ...GENERATOR_TOOLS.map((c) => `verify.generator.${c}`),
    ...["xmp", "exif", "png"].map((c) => `verify.tc260.where.${c}`),
    ...["1", "2", "3"].map((c) => `verify.tc260.label.${c}`),
    ...["organization", "person", "credit-code", "id-number", "phone", "passport", "net-id", "generation", "propagation"].map((c) => `verify.provider.${c}`),
  ];
  expect(expected.filter((k) => !keys.has(k))).toEqual([]);
});
