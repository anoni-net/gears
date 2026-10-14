// 把 Blob 存回讀者的裝置。用 blob: 網址觸發下載，不經過任何伺服器。
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // 有些瀏覽器在 click 之後才開始讀取，晚一點再收回
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
