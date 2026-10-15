// 瀏覽器解碼得了的 WAV（16 位元、單聲道）。逐字稿的測試用，錄音不進 repo
export function wav(seconds: number, sampleRate = 16000, sample: (t: number) => number = () => 0): Uint8Array {
  const count = Math.round(seconds * sampleRate);
  const out = new Uint8Array(44 + count * 2);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 單聲道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample(i / sampleRate))) * 32767, true);
  return out;
}
