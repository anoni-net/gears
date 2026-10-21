import type { ManifestStore } from "@contentauth/c2pa-types";

// C2PA 內容憑證的驗證結果（#127 的第二階段）。驗證本身由官方的 c2pa-web（c2pa-rs 編成的
// WebAssembly）完成，這裡把它回傳的資訊清單整理成查證要列的幾件事，不另外下判決：
//
// - 簽章：有效、無效，以及內容在簽署之後有沒有被改過
// - 簽署者：在不在 C2PA 的正式信任清單裡。2026-01-01 起凍結的過渡清單不用
// - 撤銷狀態：只讀簽署時附在檔案裡的 OCSP 回應，不連線查詢
// - 時間戳記、產生的軟體、動作紀錄（含數位來源類型）、素材與身分聲明

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

export interface C2paCheck {
  state: "trusted" | "valid" | "invalid";
  signer?: string; // 憑證的名稱（common name）
  issuer?: string; // 憑證的組織
  signedAt?: string; // 簽署時間，有時間戳記服務時由它證明
  timestamp: "trusted" | "untrusted" | "none";
  revocation: "not-revoked" | "revoked" | "unchecked";
  problems: C2paProblem[];
  generator?: string;
  actions: C2paAction[];
  ingredients: number;
  identity: boolean; // 附有 CAWG 的身分聲明
}

const codes = (list?: { code: string }[] | null) => (list ?? []).map((s) => s.code);

const CHANGED = /^assertion\.(dataHash|bmffHash|boxesHash|collectionHash|hashedURI)\.mismatch$/;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);

export function summarizeStore(store: ManifestStore): C2paCheck | undefined {
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

  const state = store.validation_state === "Trusted" ? "trusted" : store.validation_state === "Valid" ? "valid" : "invalid";
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

  return {
    state,
    signer: text(sig?.common_name),
    issuer: text(sig?.issuer),
    signedAt: text(sig?.time),
    timestamp: success.includes("timeStamp.trusted") ? "trusted" : success.includes("timeStamp.validated") || informational.includes("timeStamp.untrusted") ? "untrusted" : "none",
    revocation: problems.includes("revoked") ? "revoked" : success.includes("signingCredential.ocsp.notRevoked") ? "not-revoked" : "unchecked",
    problems,
    generator: generators.join("、") || text(manifest.claim_generator),
    actions: actions.filter((a) => a.action),
    ingredients: manifest.ingredients?.length ?? 0,
    identity: (manifest.assertions ?? []).some((a) => a.label.startsWith("cawg.identity")),
  };
}
