// 太舊的瀏覽器打不開 Gears：主程式的正規表示式用到 lookbehind，Safari 16.4（iOS 16.4）以前讀到這段
// 會直接出錯，整個工作台都不會執行，畫面停在建置時寫進 HTML 的說明，讀者不知道為什麼按了沒反應。
// 這支在主程式之前執行，只用舊瀏覽器也認得的寫法（不打包、不轉譯），偵測到就顯示 HTML 裡
// 依語系寫好的提示（vite.config.ts 的 localized，字串是 app.legacy）。見 AGENTS.md「支援的瀏覽器」
(function () {
  var supported = true;
  try {
    new RegExp("(?<=a)b");
  } catch (e) {
    supported = false;
  }
  if (supported) return;
  var note = document.getElementById("legacy-browser");
  if (note) note.hidden = false;
})();
