// 手機與平板：模型在這類裝置上受分頁的記憶體限制，量測頁（LlmBench.tsx）與遮蔽（RedactEditor.tsx）用來決定
// 要不要先提醒。Chromium 有 userAgentData.mobile。iPadOS 的 Safari 回報的是 Mac，靠觸控點數分出來
export function onPhone(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (data?.mobile) return true;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
