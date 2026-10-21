// 檔案工作台的 service worker：讓工作台第一次開啟之後，沒有網路也能使用。
// 建置時由 vite.config.ts 的 serviceWorker() 填入版本與檔案清單，輸出成 /gears/sw.js。
//
// 只存工作台自己的檔案（頁面、程式、圖示、165 清單），讀者放進暫存區的檔案從來不經過
// 這裡，也不會被寫進任何快取。人臉與文字辨識的模型很大，用到時才存，換版本時留著。

const VERSION = "34a6017465543dda";
const FILES = ["404.html","age-keygen/index.html","assets/AgeEditors-B6ekXnsG.js","assets/AgeKeyFields-BB9JBv1t.js","assets/BlendEditor-D56qqy9o.js","assets/DocCheckEditor-bGk74_mK.js","assets/EmailTool-sy54CYhc.js","assets/HeicConvert-owLpFeIC.js","assets/KeygenTool-Cy4bEkN4.js","assets/LlmBench-DsxLaLLK.js","assets/NearbyTool-DGhUIvuE.js","assets/PassphraseTool-CK8U50Kw.js","assets/PdfPagesEditor-CeKkeXFA.js","assets/PrintDotsEditor-COt8ve9_.js","assets/QrReadTool-Cl_WQSlE.js","assets/QrTool-C-ErJupF.js","assets/RedactEditor-BEavhuP5.js","assets/RemoteTool-DtZvISBQ.js","assets/SoftwareVerifyTool-BiDGfiP6.js","assets/TextCryptTool-X5bZ3bYD.js","assets/TranscribeEditor-C7fw66xX.js","assets/UrlCheckTool-fR_Fyvd7.js","assets/VerifyTool-ChCHUCtQ.js","assets/VideoFramesEditor-EqmByIZw.js","assets/WritingStyleTool-C7Cvn-DG.js","assets/age-CLeosRbo.js","assets/analytics-Ba0MUqe8.js","assets/asian-diceware-7776-B6etXB3N.js","assets/bytes-1yWCtDTG.js","assets/c2pa-DJ5N1zkQ.txt","assets/c2pa-check-DSLEyXGg.js","assets/cn2t-Dj0Mm1HJ.js","assets/dist-WnVDJtZt.js","assets/doc-check-DZdSgcEl.js","assets/ed25519-CscrBmyB.js","assets/es-D35yLQnx.js","assets/files-Cg-D6OMy.js","assets/gpki-cas-Bq0Hrcwj.js","assets/grca-roots-D3zAYHIZ.js","assets/hash-BHg-S_uB.js","assets/heif-wasm-CMmV8uau.js","assets/index-BodDmdcu.js","assets/index-Cb6NoFak.css","assets/index.es--_y-R7H6.js","assets/index.es-CecT58Cf.js","assets/interim-allowed-DwL_dhbj.js","assets/interim-anchors-BlsMuRBV.js","assets/interim-store-BMPDeKMl.js","assets/jsQR-BFC9zyzC.js","assets/jsxRuntime-COVSGLID.js","assets/keep-exif-CYoWI7mr.js","assets/libheif-BfiPCEgt.wasm","assets/libheif-CgtyKh8t.txt","assets/llm-bench.worker-DAdnLgF0.js","assets/material-design-icons-DdzlwXnB.txt","assets/official-svq0aKU4.js","assets/official-tsa-Btn_EhX3.js","assets/openpgp-DqDRSIyz.txt","assets/openpgp-rCAS-0gw.js","assets/ort.wasm.bundle.min-DfT_4_w9.js","assets/pdf-compare-BjqV9m_-.js","assets/pdf-lib-C4A6Ah2f.txt","assets/pdf-lib-D6N-uaYE.js","assets/pdf-pages-DOCtBeAj.js","assets/pdf-pages-j_yl5y7q.js","assets/pdf-signature-check-B72d5YME.js","assets/pdf-text-DhMsYP8J.js","assets/pdf.worker.min-CjEcRF4W.mjs","assets/pdfjs-hoTZjcxU.txt","assets/pii-DLz-_Y6w.js","assets/pkijs-BcXeo8-d.txt","assets/preload-helper-BLdHbfdN.js","assets/qrcode-HaoirK2J.js","assets/reader-DltecsD8.js","assets/redact-detect-DLPhHhUm.txt","assets/redact-detect-kQqdQJSi.js","assets/rolldown-runtime-BCiCTKAo.js","assets/save-o11YeGv3.js","assets/scam-list-loader-CNH-XumY.js","assets/sherpa.worker-DgpXkyoz.js","assets/speaker-embed-R9oPaGJR.js","assets/tesseract-BoiZRbaI.js","assets/tool-DnIUiV8R.js","assets/transcribe-BTJ8WMXQ.txt","assets/transcribe.worker-EBjqKihm.js","assets/transfer-ui-DtHn6uIK.js","assets/transformers.web-B0nuulBJ.js","assets/transformers.web-yma8JMi5.js","assets/tray-preset-k0ZWC0wl.js","assets/writing-style-J-uXbiKu.js","assets/zip-BPA6ve1j.js","assets/zxing-DHWynh-k.txt","assets/zxing_reader-Bb9Mx2Pu.wasm","blend/index.html","data/165.txt","decrypt/index.html","doc-check/index.html","email-check/index.html","en/age-keygen/index.html","en/blend/index.html","en/decrypt/index.html","en/doc-check/index.html","en/email-check/index.html","en/encrypt/index.html","en/feedback/index.html","en/heic-to-jpeg/index.html","en/index.html","en/licenses/index.html","en/llm-bench/index.html","en/nearby/index.html","en/passphrase/index.html","en/pdf-pages/index.html","en/print-dots/index.html","en/qr-read/index.html","en/qrcode/index.html","en/redact/index.html","en/remote-server/index.html","en/remote/index.html","en/samples/index.html","en/software-verify/index.html","en/storage/index.html","en/strip-metadata/index.html","en/text-crypt/index.html","en/transcribe/index.html","en/url-check/index.html","en/verify/index.html","en/video-frames/index.html","en/writing-style/index.html","encrypt/index.html","favicon.svg","feedback/index.html","heic-to-jpeg/index.html","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","licenses/index.html","llm-bench/index.html","logo-wordmark-tonal.svg","logo-wordmark-white.svg","manifest.webmanifest","nearby/index.html","passphrase/index.html","pdf-pages/index.html","print-dots/index.html","qr-read/index.html","qrcode/index.html","redact/index.html","remote-server/index.html","remote/index.html","samples/index.html","samples/qr/bitcoin.png","samples/qr/boarding-aztec.png","samples/qr/boarding-pdf417.png","samples/qr/bridge.png","samples/qr/contact.png","samples/qr/event.png","samples/qr/invoice-barcode.png","samples/qr/invoice-left.png","samples/qr/invoice-right.png","samples/qr/isbn.png","samples/qr/otp.png","samples/qr/passkey.png","samples/qr/product.png","samples/qr/promptpay-bad.png","samples/qr/promptpay.png","samples/qr/shadowsocks.png","samples/qr/signal.png","samples/qr/sms.png","samples/qr/twpay.png","samples/qr/url.png","samples/qr/wifi.png","samples/qr/wireguard.png","sitemap.xml","software-verify/index.html","storage/index.html","strip-metadata/index.html","text-crypt/index.html","transcribe/index.html","url-check/index.html","verify/index.html","video-frames/index.html","writing-style/index.html","zh-cn/age-keygen/index.html","zh-cn/blend/index.html","zh-cn/decrypt/index.html","zh-cn/doc-check/index.html","zh-cn/email-check/index.html","zh-cn/encrypt/index.html","zh-cn/feedback/index.html","zh-cn/heic-to-jpeg/index.html","zh-cn/index.html","zh-cn/licenses/index.html","zh-cn/llm-bench/index.html","zh-cn/nearby/index.html","zh-cn/passphrase/index.html","zh-cn/pdf-pages/index.html","zh-cn/print-dots/index.html","zh-cn/qr-read/index.html","zh-cn/qrcode/index.html","zh-cn/redact/index.html","zh-cn/remote-server/index.html","zh-cn/remote/index.html","zh-cn/samples/index.html","zh-cn/software-verify/index.html","zh-cn/storage/index.html","zh-cn/strip-metadata/index.html","zh-cn/text-crypt/index.html","zh-cn/transcribe/index.html","zh-cn/url-check/index.html","zh-cn/verify/index.html","zh-cn/video-frames/index.html","zh-cn/writing-style/index.html"];
const BASE = "/";
const CACHE = `gears-${VERSION}`;
// 逐字稿的 Whisper 模型（80 到 250 MB）與分辨說話者的 CAM++（28 MB）另外存一個不隨版本清掉的快取，換新版本時不必重新下載。
// 網址帶著模型的版本，清單以外的（舊版本的模型）在新版本接手時刪掉
const MODELS = "gears-models";
const MODEL_DIRS = ["models/whisper/whisper-small-36050c4/","models/whisper/whisper-base-1846881/","models/whisper/whisper-large-v3-turbo-360ebcd/","models/whisper/th-distill-small-14d3037/","models/whisper/breeze-asr-25-cffe7cc/","models/whisper/breeze-asr-26-7b99268/","models/whisper/omnilingual-ctc-300m-6abf1ec/","models/speaker/speaker-campplus-f682b51/"].map((dir) => `${BASE}${dir}`);
// 用到時才存的大檔案：人臉與文字辨識的模型、Tesseract、onnxruntime 與 c2pa 的 WebAssembly、
// pdf.js 的 CMap 與字型。檔名對內容的雜湊，建置時算好（vite.config.ts 的 serviceWorker()）。
// 存在不隨版本清掉的快取，存的時候在回應加上 HASH_HEADER，換版本時內容變了或不在清單上的才刪掉，
// 一天部署好幾次也不必每次重新下載約 23 MB（#142）
const LAZY = {"assets/c2pa_bg-CpdwZb23.js":"1bed7fa12c3a282a","assets/c2pa_bg-DOowNFv_.wasm":"01b8e25f637aaa3f","assets/ort-wasm-simd-threaded-4byDm7i3.wasm":"06ba057753da3847","assets/ort-wasm-simd-threaded-BQJNh0bu.mjs":"c57ca56328877353","assets/ort-wasm-simd-threaded-DcHrbrbl.wasm":"3398c10d07d229bd","assets/ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm":"49871f5a44095197","assets/ort-wasm-simd-threaded.asyncify-DXIbolS2.mjs":"0966b6105cd93674","models/yunet-2023mar-dynamic.onnx":"57acd73224bfbe2a","vendor/pdfjs/cmaps/78-EUC-H.bcmap":"d92a261336dc18b8","vendor/pdfjs/cmaps/78-EUC-V.bcmap":"61670bebc4e4827b","vendor/pdfjs/cmaps/78-H.bcmap":"ece6415b853d61e1","vendor/pdfjs/cmaps/78-RKSJ-H.bcmap":"696b1f973c976234","vendor/pdfjs/cmaps/78-RKSJ-V.bcmap":"53cb6d560ab377da","vendor/pdfjs/cmaps/78-V.bcmap":"289000f02fd34872","vendor/pdfjs/cmaps/78ms-RKSJ-H.bcmap":"a2442595218f5f8b","vendor/pdfjs/cmaps/78ms-RKSJ-V.bcmap":"f8ddceba96bfd9d3","vendor/pdfjs/cmaps/83pv-RKSJ-H.bcmap":"44040051ec818fe0","vendor/pdfjs/cmaps/90ms-RKSJ-H.bcmap":"c13e043e85ff715b","vendor/pdfjs/cmaps/90ms-RKSJ-V.bcmap":"499bb916ce1adbe4","vendor/pdfjs/cmaps/90msp-RKSJ-H.bcmap":"7b8b3b8bbf821702","vendor/pdfjs/cmaps/90msp-RKSJ-V.bcmap":"6296c2b5c07dca81","vendor/pdfjs/cmaps/90pv-RKSJ-H.bcmap":"fb5103f03d3a3454","vendor/pdfjs/cmaps/90pv-RKSJ-V.bcmap":"7bcb5ad2ba55b966","vendor/pdfjs/cmaps/Add-H.bcmap":"a2ffab28b9909981","vendor/pdfjs/cmaps/Add-RKSJ-H.bcmap":"b29f4b52e2465d04","vendor/pdfjs/cmaps/Add-RKSJ-V.bcmap":"2aa2232c283a3f5d","vendor/pdfjs/cmaps/Add-V.bcmap":"25125d3b1be64e86","vendor/pdfjs/cmaps/Adobe-CNS1-0.bcmap":"8c65be9d51a9f269","vendor/pdfjs/cmaps/Adobe-CNS1-1.bcmap":"73152bc1a59cc594","vendor/pdfjs/cmaps/Adobe-CNS1-2.bcmap":"a1b8d353bdef9584","vendor/pdfjs/cmaps/Adobe-CNS1-3.bcmap":"2ffc0c75c79fafde","vendor/pdfjs/cmaps/Adobe-CNS1-4.bcmap":"98a1f470c878c6b9","vendor/pdfjs/cmaps/Adobe-CNS1-5.bcmap":"ddd6e29955eb8cb5","vendor/pdfjs/cmaps/Adobe-CNS1-6.bcmap":"317bb2db71e0e5b7","vendor/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap":"e665837f2197c6bd","vendor/pdfjs/cmaps/Adobe-GB1-0.bcmap":"8b81cce8a11d510e","vendor/pdfjs/cmaps/Adobe-GB1-1.bcmap":"0426983081788ec7","vendor/pdfjs/cmaps/Adobe-GB1-2.bcmap":"e67b37a83b160ab3","vendor/pdfjs/cmaps/Adobe-GB1-3.bcmap":"aa299afc3e12a287","vendor/pdfjs/cmaps/Adobe-GB1-4.bcmap":"8fbd7d74c2ddb135","vendor/pdfjs/cmaps/Adobe-GB1-5.bcmap":"c22cb2fcff24112f","vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap":"20507620260c0c93","vendor/pdfjs/cmaps/Adobe-Japan1-0.bcmap":"464f08905236f570","vendor/pdfjs/cmaps/Adobe-Japan1-1.bcmap":"4c823848722187d1","vendor/pdfjs/cmaps/Adobe-Japan1-2.bcmap":"7810fb808e367e70","vendor/pdfjs/cmaps/Adobe-Japan1-3.bcmap":"84deb1828711ad3d","vendor/pdfjs/cmaps/Adobe-Japan1-4.bcmap":"3f8a4f974919c2b8","vendor/pdfjs/cmaps/Adobe-Japan1-5.bcmap":"1d3ce4ff28d977f8","vendor/pdfjs/cmaps/Adobe-Japan1-6.bcmap":"5609797b9401b30b","vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap":"66c5d0dc4964f409","vendor/pdfjs/cmaps/Adobe-Korea1-0.bcmap":"dfb8c3874f0e5a8c","vendor/pdfjs/cmaps/Adobe-Korea1-1.bcmap":"62f277b7b1c441c0","vendor/pdfjs/cmaps/Adobe-Korea1-2.bcmap":"1d77068af462f96d","vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap":"857b723088be9725","vendor/pdfjs/cmaps/B5-H.bcmap":"718ad0ffbef4c34f","vendor/pdfjs/cmaps/B5-V.bcmap":"b5c3738351747762","vendor/pdfjs/cmaps/B5pc-H.bcmap":"bab6028aead1d614","vendor/pdfjs/cmaps/B5pc-V.bcmap":"41543142b9767f3b","vendor/pdfjs/cmaps/CNS-EUC-H.bcmap":"e8f89cd61e6486b9","vendor/pdfjs/cmaps/CNS-EUC-V.bcmap":"cae422bec2ac6dbe","vendor/pdfjs/cmaps/CNS1-H.bcmap":"e8487971ab20cd16","vendor/pdfjs/cmaps/CNS1-V.bcmap":"42df8076aaa75745","vendor/pdfjs/cmaps/CNS2-H.bcmap":"bc6024d274d440f0","vendor/pdfjs/cmaps/CNS2-V.bcmap":"2e4f70a8afd23a12","vendor/pdfjs/cmaps/ETHK-B5-H.bcmap":"d2f10fa519336bc4","vendor/pdfjs/cmaps/ETHK-B5-V.bcmap":"1fea3fd0d9f0f679","vendor/pdfjs/cmaps/ETen-B5-H.bcmap":"87ee6b3f5bfda5fe","vendor/pdfjs/cmaps/ETen-B5-V.bcmap":"47dc0d2c21e3bde3","vendor/pdfjs/cmaps/ETenms-B5-H.bcmap":"d5f5a73da4173b7d","vendor/pdfjs/cmaps/ETenms-B5-V.bcmap":"18252fca90f472f4","vendor/pdfjs/cmaps/EUC-H.bcmap":"f9939cd57fccdc65","vendor/pdfjs/cmaps/EUC-V.bcmap":"1283a50a706507c4","vendor/pdfjs/cmaps/Ext-H.bcmap":"4000ed4e61a1c668","vendor/pdfjs/cmaps/Ext-RKSJ-H.bcmap":"e0d2f0df337660e7","vendor/pdfjs/cmaps/Ext-RKSJ-V.bcmap":"f617a22b6d67febb","vendor/pdfjs/cmaps/Ext-V.bcmap":"c2087fb845a9e3ac","vendor/pdfjs/cmaps/GB-EUC-H.bcmap":"928bad06fd84a48f","vendor/pdfjs/cmaps/GB-EUC-V.bcmap":"a9ad88ac2479da52","vendor/pdfjs/cmaps/GB-H.bcmap":"1018c777a8910b5b","vendor/pdfjs/cmaps/GB-V.bcmap":"0b96789143c0bbf9","vendor/pdfjs/cmaps/GBK-EUC-H.bcmap":"2103fed28650ede0","vendor/pdfjs/cmaps/GBK-EUC-V.bcmap":"a7fd35dd14d9dbdb","vendor/pdfjs/cmaps/GBK2K-H.bcmap":"3d919ae72af16c5c","vendor/pdfjs/cmaps/GBK2K-V.bcmap":"b927fdfd595c07ce","vendor/pdfjs/cmaps/GBKp-EUC-H.bcmap":"d15ebd8e81fb4fe8","vendor/pdfjs/cmaps/GBKp-EUC-V.bcmap":"fdc736d46e642625","vendor/pdfjs/cmaps/GBT-EUC-H.bcmap":"dc5f44e48a39f336","vendor/pdfjs/cmaps/GBT-EUC-V.bcmap":"a1ad24e63653b8aa","vendor/pdfjs/cmaps/GBT-H.bcmap":"8afda745a505763f","vendor/pdfjs/cmaps/GBT-V.bcmap":"cdc2ec5c3c7c7033","vendor/pdfjs/cmaps/GBTpc-EUC-H.bcmap":"7b23e2f7bfdb6c91","vendor/pdfjs/cmaps/GBTpc-EUC-V.bcmap":"d7a1b13ead9ab511","vendor/pdfjs/cmaps/GBpc-EUC-H.bcmap":"3c4a4eb82f05abe5","vendor/pdfjs/cmaps/GBpc-EUC-V.bcmap":"215bdfa284270562","vendor/pdfjs/cmaps/H.bcmap":"a0233e21047ec00b","vendor/pdfjs/cmaps/HKdla-B5-H.bcmap":"5242bce18fb13ab4","vendor/pdfjs/cmaps/HKdla-B5-V.bcmap":"2e0537f786c0791d","vendor/pdfjs/cmaps/HKdlb-B5-H.bcmap":"fdc8159984bf5dbe","vendor/pdfjs/cmaps/HKdlb-B5-V.bcmap":"b249eb9dcb915ab4","vendor/pdfjs/cmaps/HKgccs-B5-H.bcmap":"ab64c7fc5e9b2e97","vendor/pdfjs/cmaps/HKgccs-B5-V.bcmap":"02ebdf7cdffb5395","vendor/pdfjs/cmaps/HKm314-B5-H.bcmap":"bfd8bbde6b36a9da","vendor/pdfjs/cmaps/HKm314-B5-V.bcmap":"2a64a815cfb6fdd4","vendor/pdfjs/cmaps/HKm471-B5-H.bcmap":"49d7c037758826b5","vendor/pdfjs/cmaps/HKm471-B5-V.bcmap":"be24c109e78aa4fe","vendor/pdfjs/cmaps/HKscs-B5-H.bcmap":"08599378f41d96b4","vendor/pdfjs/cmaps/HKscs-B5-V.bcmap":"d073542b7dad1c4c","vendor/pdfjs/cmaps/Hankaku.bcmap":"b454701f7aecd785","vendor/pdfjs/cmaps/Hiragana.bcmap":"2ed669394756dd94","vendor/pdfjs/cmaps/KSC-EUC-H.bcmap":"6784e16dbc5861c0","vendor/pdfjs/cmaps/KSC-EUC-V.bcmap":"fdb36bad85e99248","vendor/pdfjs/cmaps/KSC-H.bcmap":"c1f6d61f1d3304fd","vendor/pdfjs/cmaps/KSC-Johab-H.bcmap":"939993d213f68db7","vendor/pdfjs/cmaps/KSC-Johab-V.bcmap":"5d61967aac0e666d","vendor/pdfjs/cmaps/KSC-V.bcmap":"d7da5afd9f1fe748","vendor/pdfjs/cmaps/KSCms-UHC-H.bcmap":"5b70d8f6a4fa9e22","vendor/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap":"a5e6ba22aceb02fd","vendor/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap":"890332a6a26880d4","vendor/pdfjs/cmaps/KSCms-UHC-V.bcmap":"1631b531c9a40c8c","vendor/pdfjs/cmaps/KSCpc-EUC-H.bcmap":"709480682c55cedb","vendor/pdfjs/cmaps/KSCpc-EUC-V.bcmap":"031707887d6fc237","vendor/pdfjs/cmaps/Katakana.bcmap":"3b6ca6642fbf8822","vendor/pdfjs/cmaps/LICENSE":"aa92ab5a47297486","vendor/pdfjs/cmaps/NWP-H.bcmap":"286c6c9e335da330","vendor/pdfjs/cmaps/NWP-V.bcmap":"3a75fb7b59adfb17","vendor/pdfjs/cmaps/RKSJ-H.bcmap":"a70de61a22a898f6","vendor/pdfjs/cmaps/RKSJ-V.bcmap":"68c1a64506471a52","vendor/pdfjs/cmaps/Roman.bcmap":"1c6b3ef9d9e5cb1a","vendor/pdfjs/cmaps/UniCNS-UCS2-H.bcmap":"779428116752f34e","vendor/pdfjs/cmaps/UniCNS-UCS2-V.bcmap":"1e5cc184b850ea44","vendor/pdfjs/cmaps/UniCNS-UTF16-H.bcmap":"32ff139b3c7b91d6","vendor/pdfjs/cmaps/UniCNS-UTF16-V.bcmap":"278eb1e68d1a236c","vendor/pdfjs/cmaps/UniCNS-UTF32-H.bcmap":"bf26eb67fe19ee5b","vendor/pdfjs/cmaps/UniCNS-UTF32-V.bcmap":"f7da3caf83ceb1cb","vendor/pdfjs/cmaps/UniCNS-UTF8-H.bcmap":"2f2a742bcd1a84a1","vendor/pdfjs/cmaps/UniCNS-UTF8-V.bcmap":"b7c3f10780a8c62d","vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap":"9201569b402e81ad","vendor/pdfjs/cmaps/UniGB-UCS2-V.bcmap":"f10282335e4d6420","vendor/pdfjs/cmaps/UniGB-UTF16-H.bcmap":"386fd39581245c03","vendor/pdfjs/cmaps/UniGB-UTF16-V.bcmap":"0473cfbba612b92d","vendor/pdfjs/cmaps/UniGB-UTF32-H.bcmap":"f48a145dc4e3ed1d","vendor/pdfjs/cmaps/UniGB-UTF32-V.bcmap":"106acc49b7118bde","vendor/pdfjs/cmaps/UniGB-UTF8-H.bcmap":"f217b439c80ee5fa","vendor/pdfjs/cmaps/UniGB-UTF8-V.bcmap":"a64df947632878ea","vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap":"ad2352f40870880f","vendor/pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap":"16e87edca954177c","vendor/pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap":"1973457e2c019281","vendor/pdfjs/cmaps/UniJIS-UCS2-V.bcmap":"42a133d8e2ce9dd6","vendor/pdfjs/cmaps/UniJIS-UTF16-H.bcmap":"f6a89c5688978548","vendor/pdfjs/cmaps/UniJIS-UTF16-V.bcmap":"c67126fc7c738508","vendor/pdfjs/cmaps/UniJIS-UTF32-H.bcmap":"96195950ce0fe244","vendor/pdfjs/cmaps/UniJIS-UTF32-V.bcmap":"ed4dafda402bdd19","vendor/pdfjs/cmaps/UniJIS-UTF8-H.bcmap":"798fb0bf06ab0788","vendor/pdfjs/cmaps/UniJIS-UTF8-V.bcmap":"1021611424f913b2","vendor/pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap":"710a32d7cb43fd6b","vendor/pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap":"3b149aff5c5707b5","vendor/pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap":"8d2658e18741af79","vendor/pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap":"6dd475782f289764","vendor/pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap":"691c614ce432b3e6","vendor/pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap":"40a8c7ea2d46711c","vendor/pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap":"6826f94d789d7bf1","vendor/pdfjs/cmaps/UniJISPro-UCS2-V.bcmap":"493de9fd1a08f794","vendor/pdfjs/cmaps/UniJISPro-UTF8-V.bcmap":"6181d382cf736c5e","vendor/pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap":"692044e1fb334456","vendor/pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap":"dd54e16ca7bffb3a","vendor/pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap":"f80ea5a989be30cc","vendor/pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap":"94c22bd99e771c5f","vendor/pdfjs/cmaps/UniKS-UCS2-H.bcmap":"a1081396ab4adb6f","vendor/pdfjs/cmaps/UniKS-UCS2-V.bcmap":"6cab547431958fbd","vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap":"42d35b396286499d","vendor/pdfjs/cmaps/UniKS-UTF16-V.bcmap":"5bdb7390c80dcc13","vendor/pdfjs/cmaps/UniKS-UTF32-H.bcmap":"3a01ec51ed1b8281","vendor/pdfjs/cmaps/UniKS-UTF32-V.bcmap":"dfda895eceaed081","vendor/pdfjs/cmaps/UniKS-UTF8-H.bcmap":"3fac9c65145f72d7","vendor/pdfjs/cmaps/UniKS-UTF8-V.bcmap":"9ecc6cf30dd354b9","vendor/pdfjs/cmaps/V.bcmap":"b9ad1c0c09ff14bc","vendor/pdfjs/cmaps/WP-Symbol.bcmap":"543923bead225732","vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc":"73e1ba37d2bad5ba","vendor/pdfjs/iccs/LICENSE":"286e4fd7b447330b","vendor/pdfjs/standard_fonts/FoxitDingbats.pfb":"845c752392b6c914","vendor/pdfjs/standard_fonts/FoxitFixed.pfb":"b6c8fe53f134b8b6","vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb":"f1b7159702973f54","vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb":"8a000945843bd31a","vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb":"5007faf8320fa1fc","vendor/pdfjs/standard_fonts/FoxitSerif.pfb":"4f57d2b9d884af8f","vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb":"0bdf4b04e9641398","vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb":"a406cac82583bf98","vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb":"610ae0687198045c","vendor/pdfjs/standard_fonts/FoxitSymbol.pfb":"47967d055530e735","vendor/pdfjs/standard_fonts/LICENSE_FOXIT":"b578cdd2345840ad","vendor/pdfjs/standard_fonts/LICENSE_LIBERATION":"d2c4d5b3e115a519","vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf":"361c61b82d575c5c","vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf":"a224075ac17495ad","vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf":"832b4406dbef2362","vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf":"f8ace1f892b2bd9d","vendor/pdfjs/wasm/jbig2.wasm":"466f45c2a61a6981","vendor/pdfjs/wasm/jbig2_nowasm_fallback.js":"68686ced624a48c4","vendor/pdfjs/wasm/openjpeg.wasm":"95e5002597af0824","vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js":"9047b34b6bc142d8","vendor/pdfjs/wasm/qcms_bg.wasm":"663d86126d5f5fcb","vendor/sherpa/sherpa-onnx-asr.mjs":"4f3720eafd6e25ee","vendor/sherpa/sherpa-onnx-wasm-web.js":"474c04ab7cf4db06","vendor/sherpa/sherpa-onnx-wasm-web.wasm":"be46d4ca547f4346","vendor/tessdata/chi_tra.traineddata.gz":"11fe2610dab05d8a","vendor/tessdata/eng.traineddata.gz":"45b4cb346724ac17","vendor/tesseract/tesseract-core-lstm.wasm.js":"eef5f8b2f8e20e15","vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js":"861a536cf9ef8e63","vendor/tesseract/tesseract-core-simd-lstm.wasm.js":"c58b46a4c796c0b8","vendor/tesseract/worker.min.js":"576b7df7e3393e13"};
const KEEP = "gears-keep"; // 跟 src/core/storage.ts 的 KEEP_CACHE 一致
const HASH_HEADER = "x-gears-hash";
const lazyHash = (pathname) => (pathname.startsWith(BASE) ? LAZY[pathname.slice(BASE.length)] : undefined);

// index.html 存成資料夾的網址，瀏覽器開啟的是 /gears/qrcode/ 不是 /gears/qrcode/index.html
const url = (file) => BASE + file.replace(/(^|\/)index\.html$/, "$1");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map(url))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("gears-") && ![CACHE, MODELS, KEEP].includes(key)).map((key) => caches.delete(key))))
      // 沒下載過模型就不建立這個快取
      .then(async () => {
        if (!(await caches.has(MODELS))) return;
        const cache = await caches.open(MODELS);
        for (const request of await cache.keys()) {
          if (!MODEL_DIRS.some((dir) => new URL(request.url).pathname.startsWith(dir))) await cache.delete(request);
        }
      })
      .then(async () => {
        if (!(await caches.has(KEEP))) return;
        const cache = await caches.open(KEEP);
        for (const request of await cache.keys()) {
          const hash = lazyHash(new URL(request.url).pathname);
          const response = await cache.match(request);
          if (!hash || response?.headers.get(HASH_HEADER) !== hash) await cache.delete(request);
        }
      })
      .then(() => self.clients.claim()),
  );
});

// 換版本時暫放的暫存區（src/ui/offline.ts）。只放在這個 service worker 的記憶體裡，不寫進快取或任何儲存空間，
// 重新載入的頁面拿走就放掉，最多留 HOLD_MS
let held = null;
let release = () => {};
const HOLD_MS = 60_000;

// 讀者在畫面上按「重新載入」時才換成新版本，避免同一個分頁混用新舊程式
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "skipWaiting") return self.skipWaiting();
  const reply = event.ports[0];
  if (data?.type === "hold") {
    release();
    held = data.tray;
    // 瀏覽器會停掉閒置的 service worker，暫放的檔案跟著消失。用 waitUntil 撐到頁面拿走，或時間到為止
    event.waitUntil(
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          held = null;
          resolve();
        }, HOLD_MS);
        release = () => {
          clearTimeout(timer);
          resolve();
        };
      }),
    );
    reply?.postMessage({ ok: true });
  } else if (data?.type === "take") {
    reply?.postMessage({ tray: held });
    held = null;
    release();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method !== "GET" || target.origin !== location.origin || !target.pathname.startsWith(BASE)) return;
  event.respondWith(respond(request, target, event));
});

async function respond(request, target, event) {
  if (MODEL_DIRS.some((dir) => target.pathname.startsWith(dir))) {
    const cached = await caches.match(request, { cacheName: MODELS });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(MODELS).then((cache) => cache.put(request, copy));
    }
    return response;
  }
  // 模組腳本的請求帶著 Origin，伺服器的回應常有 Vary: Origin，預先存的那份會對不上
  const options = { ignoreSearch: true, ignoreVary: true };
  const hash = lazyHash(target.pathname);
  if (hash) {
    const kept = await caches.match(request, { ...options, cacheName: KEEP });
    if (kept?.headers.get(HASH_HEADER) === hash) return kept;
  }
  const cached = await caches.match(request, { ...options, cacheName: CACHE });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (hash && response.status === 200) event.waitUntil(keep(request, response.clone(), hash));
    return response;
  } catch (error) {
    // 沒有網路時，沒存過的頁面改用首頁，由 src/router.ts 判斷要顯示哪個工具
    if (request.mode === "navigate") {
      const home = await caches.match(BASE, { cacheName: CACHE });
      if (home) return home;
    }
    throw error;
  }
}

// 存進不隨版本清掉的快取，回應加上內容的雜湊，換版本時比對
async function keep(request, response, hash) {
  try {
    const headers = new Headers(response.headers);
    headers.set(HASH_HEADER, hash);
    // 讀出來的內容已經解壓縮，原本的壓縮方式與長度對不上
    headers.delete("content-encoding");
    headers.delete("content-length");
    const body = await response.blob();
    const cache = await caches.open(KEEP);
    await cache.put(request.url, new Response(body, { status: response.status, statusText: response.statusText, headers }));
  } catch {
    // 存不進去（無痕視窗的配額很小）時下次再從網路取得
  }
}
