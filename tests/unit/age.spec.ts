import { expect, test } from "@playwright/test";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { sniff } from "../../src/core/bytes.ts";
import { decrypt, encrypt, isArmored, parseRecipients } from "../../src/tools/age/index.ts";

const data = new TextEncoder().encode("內部簡報：第三季的數字 🔒");

test("密語加密再解密，內容一樣；密語錯了解不開", async () => {
  const out = await encrypt(data, { passphrase: "correct horse battery staple", armored: false, scryptLogN: 10 });
  expect(sniff(out)).toBe("age");
  expect(await decrypt(out, "correct horse battery staple")).toEqual(data);
  await expect(decrypt(out, "wrong")).rejects.toThrow();
});

test("加密給公鑰，用私鑰解開；文字格式也認得", async () => {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const out = await encrypt(data, { recipients: [recipient], armored: true });
  expect(isArmored(out)).toBe(true);
  expect(sniff(out)).toBe("age");
  expect(await decrypt(out, `# 我的私鑰\n${identity}\n`)).toEqual(data);
  await expect(decrypt(out, await generateIdentity())).rejects.toThrow();
});

test("公鑰清單略過空行與註解，標出格式不對的", () => {
  const good = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
  expect(parseRecipients(`# 小明\n${good}\n\nssh-ed25519 AAAA\n`)).toEqual({ valid: [good], invalid: ["ssh-ed25519 AAAA"] });
});
