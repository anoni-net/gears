import { REQUEST_SURVEYS } from "../../src/request.ts";
import { expect, test } from "./guard.ts";

test("頁尾的提出需求在新分頁打開表單，帶上目前的工具與語系", async ({ page }) => {
  await page.goto("./");
  const link = page.getByTestId("request-link");
  await expect(link).toHaveText("提出需求");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  let url = new URL((await link.getAttribute("href"))!);
  expect(url.origin + url.pathname).toBe(`https://form.anoni.net/s/${REQUEST_SURVEYS["zh-TW"]}`);
  expect(url.searchParams.get("tool")).toBe("home");

  // 換工具、換語系時跟著換，站內換頁不重新載入
  await page.goto("./en/qrcode/");
  url = new URL((await page.getByTestId("request-link").getAttribute("href"))!);
  expect(url.pathname).toBe(`/s/${REQUEST_SURVEYS.en}`);
  expect(url.searchParams.get("tool")).toBe("qrcode");
  expect(url.searchParams.get("locale")).toBe("en");
  expect(url.searchParams.get("version")).toMatch(/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2} \S+$/);
});
