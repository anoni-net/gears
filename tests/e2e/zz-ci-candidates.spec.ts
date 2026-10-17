import { test } from "@playwright/test";
// 暫時的偵錯：CI 上 Firefox 交出的候選（看完就刪）
test("ci candidates", async ({ page }) => {
  await page.goto("./");
  const lines = await page.evaluate(async () => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("x");
    await pc.setLocalDescription();
    await new Promise((r) => { pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(0); setTimeout(r, 3000); });
    return pc.localDescription!.sdp.split("\n").filter((l) => /candidate|ice-|setup|fingerprint/.test(l));
  });
  console.log("CANDS\n" + lines.join("\n"));
});
