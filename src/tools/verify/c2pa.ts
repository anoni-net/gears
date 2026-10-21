import type { ManifestStore } from "@contentauth/c2pa-types";

// C2PA 內容憑證的驗證結果（#127 的第二階段）。驗證本身由官方的 c2pa-web（c2pa-rs 編成的
// WebAssembly）完成，這裡把它回傳的資訊清單整理成查證要列的幾件事，不另外下判決：
//
// - 簽章：有效、無效，以及內容在簽署之後有沒有被改過
// - 簽署者：在不在信任清單裡。先用 C2PA 的正式清單，對不上再用過渡清單，跟官方的一致性工具相同
// - 撤銷狀態：只讀簽署時附在檔案裡的 OCSP 回應，不連線查詢
// - 時間戳記、產生的軟體、動作紀錄（含數位來源類型）、素材
// - CAWG 的身分聲明與 AI 訓練的標示：創作者的帳號、簽署者，以及允不允許拿去做 AI 訓練

export type TrustList = "official" | "interim";

// C2PA 規範列出的動作，畫面上換成讀得懂的說法，其他的照原樣列出
export const C2PA_ACTIONS = [
  "c2pa.color_adjustments", "c2pa.converted", "c2pa.created", "c2pa.cropped", "c2pa.deleted", "c2pa.drawing", "c2pa.dubbed",
  "c2pa.edited", "c2pa.edited.metadata", "c2pa.enhanced", "c2pa.filtered", "c2pa.opened", "c2pa.orientation", "c2pa.placed",
  "c2pa.published", "c2pa.redacted", "c2pa.removed", "c2pa.repackaged", "c2pa.resized", "c2pa.transcoded", "c2pa.translated",
  "c2pa.trimmed", "c2pa.unknown", "c2pa.watermarked",
] as const;

export type C2paProblem = "content-changed" | "signature-invalid" | "revoked" | "expired";

export interface C2paAction {
  action: string; // c2pa.created 這類，畫面上換成讀得懂的說法
  softwareAgent?: string;
  digitalSource?: string; // IPTC 數位來源類型的代碼
}

// CAWG 身分聲明（cawg.identity）。用 X.509 憑證簽的只有憑證的名稱，Identity Claims Aggregation
// 由身分服務（例如 Adobe 的 Connected Identities）簽發，帶著創作者驗證過的社群帳號與網站
// 畫面上換成讀得懂的說法，其他的照原樣列出
export const CAWG_ACCOUNT_TYPES = ["cawg.social_media", "cawg.web_site", "cawg.affiliation", "cawg.document_verification", "cawg.crypto_wallet"] as const;
export const CAWG_TRAINING_KINDS = ["cawg.ai_generative_training", "cawg.ai_training", "cawg.ai_inference", "cawg.data_mining"] as const;
export const CAWG_TRAINING_USES = ["allowed", "notAllowed", "constrained"] as const;

export interface C2paAccount {
  type?: string; // cawg.social_media、cawg.web_site 這類
  provider?: string;
  username?: string;
  name?: string;
  uri?: string;
  verifiedAt?: string;
}

export interface C2paIdentity {
  kind: "x509" | "ica";
  issuer?: string; // ICA 的簽發者（did:web:…）或 X.509 憑證的組織
  signer?: string; // X.509 憑證的名稱
  accounts: C2paAccount[];
}

// cawg.training-mining：創作者標示允不允許拿去做 AI 訓練、推論與資料探勘
export interface C2paTraining {
  kind: string; // cawg.ai_generative_training 這類
  use: string; // allowed、notAllowed、constrained
}

export interface C2paCheck {
  state: "trusted" | "valid" | "invalid";
  trustList?: TrustList; // 受信任時是哪一份清單
  signer?: string; // 憑證的名稱（common name）
  issuer?: string; // 憑證的組織
  signedAt?: string; // 簽署時間，有時間戳記服務時由它證明
  timestamp: "trusted" | "untrusted" | "none";
  revocation: "not-revoked" | "revoked" | "unchecked";
  problems: C2paProblem[];
  generator?: string;
  actions: C2paAction[];
  ingredients: number;
  identities: C2paIdentity[];
  identityStatus?: "untrusted" | "invalid" | "offline"; // 簽發者不在信任清單裡、驗證沒有通過，或要連線才能確認
  training: C2paTraining[];
}

const codes = (list?: { code: string }[] | null) => (list ?? []).map((s) => s.code);

// 驗證 Identity Claims Aggregation 的簽發者時，c2pa-rs 會連線取得 did:web 的金鑰，這個連線不受
// allowed_network_hosts 限制（c2pa-rs issue #1645）。頁面的 CSP 只允許連自己的網域，連線一律被
// 擋下，所以這個代碼來自 Gears 不連線，不算驗證失敗
const OFFLINE = ["cawg.ica.did_unavailable"];
const TRUST_ONLY = (c: string) => c === "signingCredential.untrusted" || /^cawg\..*untrusted/.test(c) || OFFLINE.includes(c);

const CHANGED = /^assertion\.(dataHash|bmffHash|boxesHash|collectionHash|hashedURI)\.mismatch$/;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);

export function summarizeStore(store: ManifestStore, trustList?: TrustList): C2paCheck | undefined {
  const label = store.active_manifest;
  const manifest = label ? store.manifests?.[label] : undefined;
  if (!manifest) return undefined;
  const results = store.validation_results?.activeManifest;
  const failure = codes(results?.failure ?? store.validation_status);
  const success = codes(results?.success);
  const informational = codes(results?.informational);

  const problems: C2paProblem[] = [];
  if (failure.some((c) => CHANGED.test(c))) problems.push("content-changed");
  if (failure.some((c) => c.startsWith("claimSignature.") && c !== "claimSignature.outsideValidity")) problems.push("signature-invalid");
  if (failure.some((c) => c === "signingCredential.revoked" || c === "signingCredential.ocsp.revoked")) problems.push("revoked");
  if (failure.some((c) => c === "signingCredential.expired" || c === "claimSignature.outsideValidity")) problems.push("expired");

  // c2pa-rs 把連不上簽發者也算成 Invalid。只剩信任與不連線造成的代碼時，照簽章本身的結果判斷
  let state: C2paCheck["state"] = store.validation_state === "Trusted" ? "trusted" : store.validation_state === "Valid" ? "valid" : "invalid";
  if (state === "invalid" && failure.every(TRUST_ONLY)) state = success.includes("signingCredential.trusted") ? "trusted" : "valid";
  const sig = manifest.signature_info;
  const generators = (manifest.claim_generator_info ?? []).map((g) => [g.name, g.version].filter(Boolean).join(" ")).filter(Boolean);

  const actions: C2paAction[] = [];
  for (const assertion of manifest.assertions ?? []) {
    if (!assertion.label.startsWith("c2pa.actions")) continue;
    const list = (assertion.data as { actions?: unknown[] } | undefined)?.actions ?? [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      const agent = a.softwareAgent;
      actions.push({
        action: text(a.action) ?? "",
        softwareAgent: text(typeof agent === "object" && agent ? (agent as { name?: unknown }).name : agent),
        digitalSource: text(a.digitalSourceType)?.split("/").filter(Boolean).at(-1),
      });
    }
  }

  const identities: C2paIdentity[] = [];
  const training: C2paTraining[] = [];
  for (const assertion of manifest.assertions ?? []) {
    const data = assertion.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") continue;
    if (assertion.label.startsWith("cawg.identity")) {
      const sig = data.signature_info as Record<string, unknown> | undefined;
      const accounts = Array.isArray(data.verifiedIdentities) ? data.verifiedIdentities : [];
      identities.push({
        kind: Array.isArray(data.verifiedIdentities) || data.issuer ? "ica" : "x509",
        issuer: text(data.issuer) ?? text(sig?.issuer),
        signer: text(sig?.common_name),
        accounts: accounts
          .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
          .map((a) => {
            const provider = a.provider as Record<string, unknown> | undefined;
            return { type: text(a.type), provider: text(provider?.name) ?? text(provider?.id), username: text(a.username), name: text(a.name), uri: text(a.uri), verifiedAt: text(a.verifiedAt) };
          }),
      });
    } else if (assertion.label.startsWith("cawg.training-mining") && data.entries && typeof data.entries === "object") {
      for (const [kind, value] of Object.entries(data.entries as Record<string, unknown>)) {
        const use = text((value as { use?: unknown } | undefined)?.use);
        if (use) training.push({ kind, use });
      }
    }
  }
  // 身分聲明的簽發者不受信任時，X.509 的列在 failure，Identity Claims Aggregation 的列在 informational
  const cawg = [...failure, ...informational].filter((c) => c.startsWith("cawg."));
  const identityStatus = cawg.some((c) => OFFLINE.includes(c))
    ? "offline"
    : failure.some((c) => c.startsWith("cawg.") && !/untrusted/.test(c))
      ? "invalid"
      : cawg.some((c) => /untrusted/.test(c))
        ? "untrusted"
        : undefined;

  return {
    state,
    trustList: state === "trusted" ? trustList : undefined,
    signer: text(sig?.common_name),
    issuer: text(sig?.issuer),
    signedAt: text(sig?.time),
    timestamp: success.includes("timeStamp.trusted") ? "trusted" : success.includes("timeStamp.validated") || informational.includes("timeStamp.untrusted") ? "untrusted" : "none",
    revocation: problems.includes("revoked") ? "revoked" : success.includes("signingCredential.ocsp.notRevoked") ? "not-revoked" : "unchecked",
    problems,
    generator: generators.join("、") || text(manifest.claim_generator),
    actions: actions.filter((a) => a.action),
    ingredients: manifest.ingredients?.length ?? 0,
    identities,
    identityStatus,
    training,
  };
}

// 正式清單驗證之後簽署者不受信任，才改用過渡清單再驗一次
export const needsInterim = (store: ManifestStore) =>
  store.validation_state !== "Trusted" && codes(store.validation_results?.activeManifest?.failure ?? store.validation_status).includes("signingCredential.untrusted");
