// 確認打包好的轉送服務（dist-server/relay.mjs）在 Node.js 裡跑得起來：開房、加入、轉送一則訊息。
// CI 與 deploy.yml 在建置之後執行，打包漏了相依套件時在這裡失敗，不會推到主機上才發現。
//
//   node scripts/check-relay.mjs [dist-server/relay.mjs]
import { spawn } from "node:child_process";

const file = process.argv[2] ?? "dist-server/relay.mjs";
const child = spawn(process.execPath, [file], { env: { ...process.env, RELAY_PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
const fail = (message) => {
  console.error(`check-relay: ${message}`);
  child.kill();
  process.exit(1);
};
setTimeout(() => fail("逾時"), 10_000).unref();

const url = await new Promise((resolve) => {
  let out = "";
  child.stdout.on("data", (chunk) => {
    out += chunk;
    const m = out.match(/listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  child.on("exit", (code) => fail(`轉送服務結束了（${code}）`));
});

function connect(hello) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const queue = [];
  const waiting = [];
  ws.addEventListener("message", (e) => (waiting.length ? waiting.shift()(e.data) : queue.push(e.data)));
  ws.addEventListener("open", () => ws.send(JSON.stringify(hello)));
  return { ws, next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r))) };
}

const a = connect({ t: "open", v: 1 });
const room = JSON.parse(await a.next());
if (room.t !== "room") fail(`開房失敗：${JSON.stringify(room)}`);
const b = connect({ t: "join", v: 1, room: room.room });
if (JSON.parse(await b.next()).t !== "paired" || JSON.parse(await a.next()).t !== "paired") fail("沒有配對");
a.ws.send(Uint8Array.from([1, 4, 2]));
const got = new Uint8Array(await b.next());
if (got.join() !== "1,4,2") fail(`轉送的內容不對：${got.join()}`);
a.ws.close(1000);
console.log(`check-relay: ${file} 可以開房、配對與轉送`);
child.kill();
process.exit(0);
