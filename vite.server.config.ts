// 轉送服務（server/）的建置：打包成單一個 ES module（dist-server/relay.mjs），連同 ws 一起，
// 主機上不必執行 npm install。deploy.yml 推到 build 分支的 server/，在容器裡用 Node.js 執行
// （tools/relay-compose.yml）。網站的建置是 vite.config.ts，兩邊不共用設定。
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    ssr: "server/main.ts",
    outDir: "dist-server",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      // ws 會試著載入選用的原生加速套件，沒有就用純 JavaScript 的版本
      external: ["bufferutil", "utf-8-validate"],
      output: { entryFileNames: "relay.mjs" },
    },
  },
  ssr: { noExternal: true, target: "node" },
});
