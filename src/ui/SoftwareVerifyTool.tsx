import { useEffect, useRef, useState } from "preact/hooks";
import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { type Outcome, SIGNERS, groupFingerprint, looksLikeSignature, verifyDownload } from "../tools/software-verify/index.ts";
import { KEYS_CHECKED } from "../tools/software-verify/keys.ts";
import { SIGNATURE_MAX, signedName } from "../tools/software-verify/signature.ts";
import { trackFail, useDoneOnce } from "./analytics.ts";
import type { CreateToolProps } from "./types.ts";
import { useWorking } from "./working.ts";
import { tray } from "../state.ts";
import { latestAsFile, trayFileFromPreset } from "./tray-preset.ts";

// 下載的軟體驗證（src/tools/software-verify/）。讀者選下載的檔案與簽章檔，選好就開始驗證。
// 檔案不放進暫存區：安裝檔動輒幾百 MB，驗證只需要讀一次。

async function isSignatureFile(file: File) {
  return file.size <= SIGNATURE_MAX && looksLikeSignature(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
}

const pairs = (file: File, signature: File) => signedName(signature.name) === file.name;

function Verdict({ outcome, created }: { outcome: Outcome; created?: string }) {
  const tone = outcome.kind === "good" ? "pass" : outcome.kind === "bad" ? "fail" : "unclear";
  const signer = "signer" in outcome ? tDynamic(`software.signer.${outcome.signer}`) : "";
  return (
    <div class={`email-verdict ${tone}`} role="status" data-testid="software-verdict">
      <strong>{tDynamic(`software.result.${outcome.kind}`)}</strong>
      <p>{tDynamic(`software.result.${outcome.kind}.desc`, { signer, keyId: outcome.kind === "unknown-key" ? outcome.keyId : "" })}</p>
      {outcome.kind === "good" ? (
        <p>
          {t("software.signedAt", { date: created! })}
          <br />
          {t("software.subkey")} <code>{groupFingerprint(outcome.subkey)}</code>
        </p>
      ) : null}
    </div>
  );
}

export function SoftwareVerifyTool({ preset }: CreateToolProps) {
  const [file, setFile] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ outcome: Outcome; sha256: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sigInput = useRef<HTMLInputElement>(null);
  useWorking(progress !== null);
  useDoneOnce("software-verify", !!result);

  // 從暫存區的檔案打開（檔案畫面的工具列表）：放進對的位置，暫存區裡有成對的檔案時一起帶過來
  useEffect(() => {
    const from = trayFileFromPreset(preset);
    if (!from) return;
    const others = tray.get().files.filter((f) => f.id !== from.id);
    void (async () => {
      const picked = latestAsFile(from);
      if (await isSignatureFile(picked)) {
        setSignature(picked);
        const target = others.find((f) => f.name === signedName(from.name));
        if (target) setFile(latestAsFile(target));
      } else {
        setFile(picked);
        const sig = others.find((f) => f.name !== from.name && signedName(f.name) === from.name);
        if (sig) setSignature(latestAsFile(sig));
      }
    })();
  }, [preset]);

  // 選檔案時一次選了兩個，或把簽章檔選到檔案那一格，自動放到對的位置
  const pick = async (e: Event, slot: "file" | "signature") => {
    const el = e.currentTarget as HTMLInputElement;
    const picked = [...(el.files ?? [])];
    el.value = "";
    for (const f of picked) {
      if (slot === "signature" || (await isSignatureFile(f))) setSignature(f);
      else setFile(f);
    }
  };

  useEffect(() => {
    if (!file || !signature) return;
    let alive = true;
    setResult(null);
    setFailed(false);
    setProgress(0);
    void (async () => {
      try {
        const bytes = new Uint8Array(await signature.arrayBuffer());
        const out = await verifyDownload(file, bytes, (done) => alive && setProgress(done));
        if (alive) setResult(out);
      } catch {
        trackFail("software-verify", "broken");
        if (alive) setFailed(true);
      } finally {
        if (alive) setProgress(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, signature]);

  const created = result?.outcome.kind === "good" ? result.outcome.created.toLocaleString(getLocale(), { dateStyle: "long", timeStyle: "short" }) : undefined;
  return (
    <div class="software-verify">
      <p class="hint">{t("software.intro")}</p>
      <div class="software-picks">
        <div>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => pick(e, "file")} data-testid="software-file" />
          <button type="button" class={file ? "" : "primary"} onClick={() => fileInput.current?.click()}>
            {t("software.pickFile")}
          </button>
          <p class="hint">{file ? file.name : t("software.pickFile.hint")}</p>
        </div>
        <div>
          <input ref={sigInput} type="file" accept=".asc,.sig,.gpg,application/pgp-signature" hidden onChange={(e) => pick(e, "signature")} data-testid="software-signature" />
          <button type="button" class={file && !signature ? "primary" : ""} onClick={() => sigInput.current?.click()}>
            {t("software.pickSignature")}
          </button>
          <p class="hint">{signature ? signature.name : t("software.pickSignature.hint")}</p>
        </div>
      </div>
      {file && signature && !pairs(file, signature) ? (
        <p class="hint" data-testid="software-mismatch">
          {t("software.nameMismatch")}
        </p>
      ) : null}
      {progress !== null && file ? (
        <div role="status">
          <progress max={file.size} value={progress} />
          <p class="hint">{t("software.reading", { n: Math.floor((progress / Math.max(file.size, 1)) * 100) })}</p>
        </div>
      ) : null}
      {failed ? (
        <p class="error" role="alert">
          {t("software.failed")}
        </p>
      ) : null}
      {result ? (
        <>
          <Verdict outcome={result.outcome} created={created} />
          <p class="hint">
            SHA-256 <code class="hash">{result.sha256}</code>
          </p>
        </>
      ) : null}
      <section class="software-keys" aria-labelledby="software-keys-title">
        <h3 id="software-keys-title">{t("software.keys")}</h3>
        <ul>
          {SIGNERS.map((s) => (
            <li key={s.id}>
              <strong>{tDynamic(`software.signer.${s.id}`)}</strong>
              <code>{groupFingerprint(s.fingerprint)}</code>
              <span class="hint">{tDynamic(`software.where.${s.id}`)}</span>
              <a href={s.source} target="_blank" rel="noopener noreferrer">
                {t("software.official")}
              </a>
            </li>
          ))}
        </ul>
        <p class="hint">{t("software.checked", { date: KEYS_CHECKED })}</p>
      </section>
      <p class="hint">{t("software.limits")}</p>
    </div>
  );
}
