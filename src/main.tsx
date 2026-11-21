import { render } from "preact";
import { App } from "./app.tsx";
import "./styles.css";

// #app 裡是建置時寫進 HTML 的這一頁的說明（vite.config.ts 的 staticContent），給不執行 JavaScript 的
// 搜尋引擎與讀者看。換成工作台之前清空，Preact 才不會拿那些元素去比對
const root = document.getElementById("app")!;
root.replaceChildren();
render(<App />, root);
