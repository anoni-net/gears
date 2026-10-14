// 金鑰產生器產生的金鑰組，跟暫存區一樣只放在這個分頁的記憶體裡。放在元件外面，
// 讀者到其他工具再回來時金鑰還在，關掉分頁才會消失。
//
// 私鑰還沒存下來（下載、複製或放進暫存區）時，關掉分頁或重新整理之前請瀏覽器先確認，
// 私鑰遺失了，用公鑰加密的檔案就解不開。

export interface KeyPair {
  identity: string;
  recipient: string;
  file: string;
}

let pair: KeyPair | null = null;
let saved = false;

export const keygenSession = {
  get: () => pair,
  isSaved: () => saved,
  set(next: KeyPair) {
    pair = next;
    saved = false;
  },
  markSaved() {
    saved = true;
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (pair && !saved) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
