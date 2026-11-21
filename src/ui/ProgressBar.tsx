// 處理中的進度條（AGENTS.md「設計語言」的提示與狀態）。value 是 0 到 1，不知道要多久時傳 null，
// 畫成來回移動的條紋。旁邊的說明文字由呼叫的地方另外寫一行 role="status"，處理中的容器標 aria-busy
export function ProgressBar({ label, value }: { label: string; value: number | null }) {
  const percent = value === null ? null : Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div class="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      <div class={percent === null ? "progress-bar indeterminate" : "progress-bar"} style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  );
}
