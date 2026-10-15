import type { Format } from "../core/bytes.ts";
import type { IconName } from "./icon-paths.ts";

// 暫存區裡沒有預覽圖的檔案，用檔案類型的圖示代替灰色方塊，一眼看得出是什麼檔案
const ICONS: Partial<Record<Format, IconName>> = {
  docx: "file-word-box",
  xlsx: "file-excel-box",
  pptx: "file-powerpoint-box",
  odt: "file-document-outline",
  ods: "file-table-outline",
  odp: "file-presentation-box",
  odg: "file-image-outline",
  pdf: "file-pdf-box",
  epub: "book-open-page-variant-outline",
  html: "language-html5",
  zip: "folder-zip-outline",
  tar: "folder-zip-outline",
  gz: "folder-zip-outline",
  torrent: "magnet",
  age: "file-lock-outline",
  mp3: "file-music-outline",
  m4a: "file-music-outline",
  wav: "file-music-outline",
  flac: "file-music-outline",
  ogg: "file-music-outline",
  opus: "file-music-outline",
  mp4: "file-video-outline",
  mov: "file-video-outline",
  avi: "file-video-outline",
  mkv: "file-video-outline",
  webm: "file-video-outline",
};

// 圖片類的格式顯示不出預覽時（例如 Chrome 的 HEIC、TIFF）用圖片的圖示
export function fileIcon(format: Format, isImage: boolean): IconName {
  return ICONS[format] ?? (isImage ? "file-image-outline" : "file-outline");
}
