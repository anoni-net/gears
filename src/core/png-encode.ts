// 產生黑白兩色的 PNG，不經過 canvas。
//
// Brave 預設會擾動 canvas 讀出來的像素（防指紋），用 canvas 匯出的圖可能帶著
// 雜訊，每次也不一樣。QR code 這類只有黑白方格的圖直接寫位元組：1 位元灰階、
// 不壓縮的 deflate 區塊，輸出固定，也能在 Node 裡測。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// zlib 包裝的 deflate，只用不壓縮的區塊（每塊最多 65535 位元組）
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const len = Math.min(65535, data.length - start);
    out[at] = i === blocks - 1 ? 1 : 0;
    out[at + 1] = len & 0xff;
    out[at + 2] = len >> 8;
    out[at + 3] = ~len & 0xff;
    out[at + 4] = (~len >> 8) & 0xff;
    out.set(data.subarray(start, start + len), at + 5);
    at += 5 + len;
  }
  new DataView(out.buffer).setUint32(at, adler32(data));
  return out;
}

// dark(x, y) 為真的像素畫成黑色，其餘白色
export function encodeBilevelPng(width: number, height: number, dark: (x: number, y: number) => boolean): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1); // 每列開頭的 0 是過濾方式「不過濾」
    for (let x = 0; x < width; x++) {
      if (!dark(x, y)) raw[row + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 1; // 位元深度
  ihdr[9] = 0; // 灰階
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlibStored(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
