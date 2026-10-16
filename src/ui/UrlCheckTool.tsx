import { useState } from "preact/hooks";
import { list as joinList, t, tDynamic } from "../i18n/index.ts";
import { cleanUrl, isShortener, parseUrl } from "../tools/url-check/clean.ts";
import { type HostWarning, hostFacts } from "../tools/url-check/host.ts";
import { type ScamList, findScam } from "../tools/url-check/scam-list.ts";
import { useScamList } from "./scam-list-loader.ts";
import { CopyButton } from "./CopyButton.tsx";
import type { CreateToolProps } from "./types.ts";

function warningText(w: HostWarning) {
  return tDynamic(`url.warn.${w.kind}`, { detail: "detail" in w ? w.detail : "" });
}

// 主機名裡真正的註冊網域加粗，前面的子網域淡化，障眼法一眼看得出來
function HostLine({ display, registrable }: { display: string; registrable: string }) {
  const head = display.endsWith(registrable) ? display.slice(0, display.length - registrable.length) : "";
  return (
    <p class="host-line">
      <span class="sub">{head}</span>
      <strong>{head ? registrable : display}</strong>
    </p>
  );
}

export function UrlCheckTool({ preset }: CreateToolProps) {
  const [input, setInput] = useState(preset ?? "");
  const list = useScamList();
  const parsed = parseUrl(input);

  return (
    <div class="url-check">
      <label class="field">
        {t("url.input")}
        <input
          type="text"
          inputMode="url"
          value={input}
          placeholder="https://"
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          onInput={(e) => setInput(e.currentTarget.value)}
        />
      </label>
      <p class="hint">{t("url.privacy")}</p>

      {typeof parsed === "string" ? (
        parsed === "empty" ? null : (
          <p class="error" role="alert">
            {tDynamic(`url.error.${parsed}`)}
          </p>
        )
      ) : (
        <Result url={parsed} list={list} />
      )}
    </div>
  );
}

function Result({ url, list }: { url: URL; list: ScamList | null | undefined }) {
  const cleaned = cleanUrl(url);
  const facts = hostFacts(cleaned.url);
  const scam = list ? findScam(cleaned.url.hostname, list) : null;

  return (
    <div class="url-result">
      <section aria-labelledby="scam-title">
        <h3 id="scam-title">{t("url.scam.title")}</h3>
        {list === undefined ? (
          <p class="hint">{t("url.scam.loading")}</p>
        ) : list === null ? (
          <p class="hint">{t("url.scam.unavailable")}</p>
        ) : scam ? (
          <p class="alert danger" role="alert">
            {t("url.scam.hit", { domain: scam, to: list.to ?? "" })}
          </p>
        ) : (
          <p class="alert">{t("url.scam.miss", { to: list.to ?? "" })}</p>
        )}
      </section>

      <section aria-labelledby="host-title">
        <h3 id="host-title">{t("url.host.title")}</h3>
        <HostLine display={facts.display} registrable={facts.registrableDisplay} />
        <p class="hint">{t("url.host.registrable", { domain: facts.registrableDisplay })}</p>
        {facts.warnings.length ? (
          <ul class="findings">
            {facts.warnings.map((w, i) => (
              <li key={i}>
                <span>{warningText(w)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {isShortener(cleaned.url.hostname) ? <p class="alert">{t("url.shortener")}</p> : null}
      </section>

      <section aria-labelledby="clean-title">
        <h3 id="clean-title">{t("url.clean.title")}</h3>
        {cleaned.unwrapped.length ? <p class="hint">{t("url.clean.unwrapped", { hosts: joinList(cleaned.unwrapped) })}</p> : null}
        {cleaned.removed.length ? (
          <ul class="params">
            {cleaned.removed.map((r) => (
              <li key={r.name}>
                <code>{r.name}</code>
                <span>{tDynamic(`url.owner.${r.owner}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="ok">{t("url.clean.none")}</p>
        )}
        <output class="secret clean-url" data-testid="clean-url">
          {cleaned.clean}
        </output>
        <div class="buttons">
          <CopyButton text={cleaned.clean} label={t("url.clean.copy")} />
        </div>
      </section>
    </div>
  );
}
