// Zenodo DOI registration: pure, side-effect-free rules (config, validation, metadata, DOI confirmation, retry policy).
// The HTTP client and the database orchestration live in server/zenodo.server.ts and call into this file, so every rule here is unit-tested
// without credentials. Paperly never invents a DOI: a DOI string is accepted only from a *published* Zenodo response and only after validateConfirmedDoi().

export type ZenodoEnvironment = "sandbox" | "production";
export type ZenodoWorkflowStatus = "not_started" | "pending" | "uploading" | "publishing" | "registered" | "failed";

export const ZENODO_BASE_URL: Record<ZenodoEnvironment, string> = { sandbox: "https://sandbox.zenodo.org/api", production: "https://zenodo.org/api" };
export const ZENODO_HOST: Record<ZenodoEnvironment, string> = { sandbox: "sandbox.zenodo.org", production: "zenodo.org" };
/** Zenodo's DOI prefixes: 10.5281 (production), 10.5072 (sandbox test DOIs, not resolvable at doi.org). */
export const ZENODO_DOI_PREFIX: Record<ZenodoEnvironment, string> = { sandbox: "10.5072", production: "10.5281" };
export const MAX_ATTEMPTS = 5;
export const LEASE_SECONDS = 300;
export const REQUEST_TIMEOUT_MS = 25_000;
export const UPLOAD_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------- configuration

export type ZenodoConfig =
  | { ok: true; environment: ZenodoEnvironment; baseUrl: string; token: string }
  | { ok: false; code: "ZENODO_ENV_INVALID" | "ZENODO_TOKEN_MISSING" | "ZENODO_PRODUCTION_DISABLED"; message: string };

/** Reads server-side secrets only. Separate tokens per environment are preferred (ZENODO_ACCESS_TOKEN_SANDBOX / _PRODUCTION);
 *  ZENODO_ACCESS_TOKEN is the token for whichever environment ZENODO_ENVIRONMENT selects. Production also needs the admin switch. */
export function resolveZenodoConfig(env: Record<string, string | undefined>, productionEnabled: boolean): ZenodoConfig {
  const raw = (env["ZENODO_ENVIRONMENT"] ?? "").trim().toLowerCase();
  if (raw !== "sandbox" && raw !== "production") return { ok: false, code: "ZENODO_ENV_INVALID", message: "ZENODO_ENVIRONMENT must be set to sandbox or production" };
  const environment: ZenodoEnvironment = raw;
  const token = (env[`ZENODO_ACCESS_TOKEN_${environment.toUpperCase()}`] ?? env["ZENODO_ACCESS_TOKEN"] ?? "").trim();
  if (!token) return { ok: false, code: "ZENODO_TOKEN_MISSING", message: `No Zenodo access token is configured for the ${environment} environment` };
  if (environment === "production" && !productionEnabled) return { ok: false, code: "ZENODO_PRODUCTION_DISABLED", message: "Production DOI registration is switched off. An administrator must enable production in the Zenodo admin screen" };
  return { ok: true, environment, baseUrl: ZENODO_BASE_URL[environment], token };
}

/** Safe status for the admin screen: never contains the token or any part of it. */
export function publicConfigStatus(env: Record<string, string | undefined>, productionEnabled: boolean) {
  const c = resolveZenodoConfig(env, productionEnabled);
  const raw = (env["ZENODO_ENVIRONMENT"] ?? "").trim().toLowerCase();
  return { configured: c.ok, environment: raw === "sandbox" || raw === "production" ? raw : null, error: c.ok ? null : { code: c.code, message: c.message }, tokenPresent: !!(env["ZENODO_ACCESS_TOKEN"] || env["ZENODO_ACCESS_TOKEN_SANDBOX"] || env["ZENODO_ACCESS_TOKEN_PRODUCTION"]) };
}

/** Removes any occurrence of a secret from text before it is logged, stored or shown. */
export function redactSecret(text: string, ...secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[redacted]").replace(/(access_token=)[^&\s"]+/gi, "$1[redacted]");
}

// ---------------------------------------------------------------- publication input and validation

export interface ZenodoAuthor { name: string; affiliation?: string | null; orcid?: string | null }
export interface ZenodoPaperInput {
  paperlyId: string; title: string; abstract: string; keywords: string[]; authors: ZenodoAuthor[];
  publicationDate: string; // YYYY-MM-DD
  license: string | null; publicationType: string | null; articleUrl: string; version: string | null;
  status: string; deleted: boolean; peerReviewed: boolean;
  /** Final manuscript file. Zenodo always receives a PDF: a PDF is deposited as approved, a Word (.docx) file is converted to PDF first. */
  file: { kind: "pdf" | "docx" | "other"; sizeBytes: number; sha256Expected: string | null } | null;
  approval: { approvedAt: string | null; approvedBy: string | null };
}

export type ValidationCode =
  | "NOT_PUBLICATION_READY" | "NOT_APPROVED" | "TITLE_MISSING" | "ABSTRACT_MISSING" | "AUTHORS_MISSING" | "AUTHOR_NAME_MISSING"
  | "ORCID_INVALID" | "DATE_INVALID" | "LICENSE_NOT_OPEN" | "LICENSE_UNKNOWN" | "FILE_MISSING" | "FILE_NOT_PDF" | "FILE_EMPTY" | "FILE_TOO_LARGE" | "ARTICLE_URL_INVALID";
export interface ValidationIssue { code: ValidationCode; message: string }

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
export const ZENODO_LICENSE: Record<string, string> = { "CC-BY": "cc-by-4.0", "CC-BY-NC": "cc-by-nc-4.0", "CC-BY-NC-ND": "cc-by-nc-nd-4.0" };
const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024; // Zenodo's per-record limit; Paperly's own upload cap is far lower.

export function validateForDeposit(p: ZenodoPaperInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const add = (code: ValidationCode, message: string) => out.push({ code, message });
  if (p.deleted || p.status !== "PUBLICATION_PENDING") add("NOT_PUBLICATION_READY", "A DOI can only be registered for an accepted record that is in production and has not been removed");
  if (!p.approval.approvedAt || !p.approval.approvedBy) add("NOT_APPROVED", "An authorised editor must explicitly approve publication before a DOI is registered");
  if (!p.title.trim()) add("TITLE_MISSING", "The title is missing");
  if (!p.abstract.trim()) add("ABSTRACT_MISSING", "The abstract is missing");
  if (!p.authors.length) add("AUTHORS_MISSING", "At least one author is required");
  p.authors.forEach((a, i) => {
    if (!a.name.trim()) add("AUTHOR_NAME_MISSING", `Author ${i + 1} has no name`);
    if (a.orcid && !ORCID_RE.test(a.orcid)) add("ORCID_INVALID", `Author ${i + 1} has a malformed ORCID iD`);
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.publicationDate) || Number.isNaN(Date.parse(p.publicationDate))) add("DATE_INVALID", "The publication date must be a valid YYYY-MM-DD date");
  if (!p.license) add("LICENSE_UNKNOWN", "No licence has been recorded");
  else if (!ZENODO_LICENSE[p.license]) add(p.license === "ALL-RIGHTS-RESERVED" ? "LICENSE_NOT_OPEN" : "LICENSE_UNKNOWN", p.license === "ALL-RIGHTS-RESERVED" ? "A Zenodo DOI deposit makes the PDF openly available, which needs an open (Creative Commons) licence" : `Licence ${p.license} cannot be mapped to a Zenodo licence`);
  if (!/^https:\/\/[^\s/]+\/article\/[A-Za-z0-9-]+$/.test(p.articleUrl)) add("ARTICLE_URL_INVALID", "The public article address is not a valid https URL");
  if (!p.file) add("FILE_MISSING", "The final approved manuscript file could not be found");
  else {
    if (p.file.kind !== "pdf" && p.file.kind !== "docx") add("FILE_NOT_PDF", "The final manuscript is neither a PDF nor a Word (.docx) file; only a PDF, or a Word file that can be converted to PDF, can be deposited");
    if (p.file.sizeBytes <= 0) add("FILE_EMPTY", "The final manuscript file is empty");
    if (p.file.sizeBytes > MAX_FILE_BYTES) add("FILE_TOO_LARGE", "The final manuscript file is too large for Zenodo");
  }
  return out;
}

// ---------------------------------------------------------------- metadata

/** "Given Family" -> "Family, Given" (Zenodo's creator format). Names already containing a comma are kept. */
export function creatorName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.includes(",")) return n;
  const parts = n.split(" ");
  return parts.length < 2 ? n : `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Marker stored in the deposit notes so an uncertain create can be found again instead of repeated. */
export const idempotencyMarker = (key: string) => `paperly-idempotency:${key}`;

export function zenodoResourceType(publicationType: string | null): { upload_type: "publication"; publication_type: string } {
  const t = (publicationType ?? "").toUpperCase();
  if (t.includes("PREPRINT")) return { upload_type: "publication", publication_type: "preprint" };
  if (t.includes("REPORT")) return { upload_type: "publication", publication_type: "report" };
  return { upload_type: "publication", publication_type: "article" };
}

export function buildDepositMetadata(p: ZenodoPaperInput, idempotencyKey: string) {
  const license = ZENODO_LICENSE[p.license ?? ""];
  return {
    ...zenodoResourceType(p.publicationType),
    title: p.title.trim(),
    creators: p.authors.map((a) => ({ name: creatorName(a.name), ...(a.affiliation?.trim() ? { affiliation: a.affiliation.trim() } : {}), ...(a.orcid ? { orcid: a.orcid } : {}) })),
    description: `<p>${esc(p.abstract.trim()).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    publication_date: p.publicationDate,
    access_right: "open" as const,
    license,
    ...(p.keywords.length ? { keywords: p.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 30) } : {}),
    ...(p.version ? { version: p.version } : {}),
    // The Paperly article page is the same work, hosted on the platform. This is a link, not a claim of peer review or indexing.
    related_identifiers: [{ identifier: p.articleUrl, relation: "isIdenticalTo", scheme: "url", resource_type: "publication-article" }],
    notes: idempotencyMarker(idempotencyKey),
    prereserve_doi: false,
  };
}
export type DepositMetadata = ReturnType<typeof buildDepositMetadata>;

// ---------------------------------------------------------------- confirming a DOI

export type ConfirmedDoi = { ok: true; doi: string; doiUrl: string; recordUrl: string; recordId: number } | { ok: false; code: "DOI_NOT_CONFIRMED"; message: string };
const DOI_RE = /^10\.\d{4,9}\/[^\s]+$/;

/** A DOI is accepted only from a deposition that Zenodo reports as submitted+published, with a DOI of the right prefix for the environment
 *  and a public record URL on the right host. Reserved (prereserved) or pending identifiers never pass. */
export function validateConfirmedDoi(dep: unknown, env: ZenodoEnvironment, expectedDepositId?: number | null): ConfirmedDoi {
  const bad = (message: string): ConfirmedDoi => ({ ok: false, code: "DOI_NOT_CONFIRMED", message });
  if (!dep || typeof dep !== "object") return bad("Zenodo returned no record");
  const d = dep as Record<string, unknown>;
  const links = (d["links"] ?? {}) as Record<string, unknown>;
  const id = typeof d["id"] === "number" ? d["id"] : Number(d["id"]);
  if (!Number.isInteger(id) || id <= 0) return bad("Zenodo returned no record id");
  if (expectedDepositId && id !== expectedDepositId) return bad("Zenodo returned a different record than the one that was published");
  if (d["submitted"] !== true || d["state"] !== "done") return bad("The Zenodo record is not published yet");
  const doi = typeof d["doi"] === "string" ? d["doi"].trim() : "";
  if (!DOI_RE.test(doi)) return bad("Zenodo returned no confirmed DOI");
  if (!doi.startsWith(`${ZENODO_DOI_PREFIX[env]}/`)) return bad(`The DOI does not use the ${env} prefix ${ZENODO_DOI_PREFIX[env]}`);
  const recordUrl = typeof links["record_html"] === "string" ? links["record_html"] : typeof links["html"] === "string" ? links["html"] : "";
  try {
    const u = new URL(recordUrl);
    if (u.protocol !== "https:" || u.hostname !== ZENODO_HOST[env]) return bad("The public record URL is not on the expected Zenodo host");
  } catch { return bad("Zenodo returned no public record URL"); }
  return { ok: true, doi, doiUrl: `https://doi.org/${doi}`, recordUrl, recordId: id };
}

/** Sandbox DOIs (10.5072) do not resolve at doi.org; the UI labels them as test DOIs. */
export const isSandboxDoi = (doi: string) => doi.startsWith(`${ZENODO_DOI_PREFIX.sandbox}/`);
export const doiHref = (doi: string) => `https://doi.org/${doi}`;

// ---------------------------------------------------------------- errors, retries, state machine

export type ErrorKind = "timeout" | "network" | "rate_limit" | "server" | "auth" | "validation" | "conflict" | "not_found" | "unknown";
export interface ClassifiedError { kind: ErrorKind; code: string; retryable: boolean; retryAfterMs: number | null; message: string }

/** A short, safe description of what Zenodo actually answered: its own JSON message when there is one, or a note that a web page
 *  (typically a firewall or Cloudflare block) came back instead. Never contains more than 200 characters. */
export function describeZenodoBody(body?: string): string {
  const raw = (body ?? "").trim();
  if (!raw) return "no details were returned";
  if (/^</.test(raw)) return "Zenodo answered with a web page instead of API data (usually a firewall or bot block, not a token problem)";
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const parts = [j["message"], j["error"], j["error_description"]].filter((v) => typeof v === "string" && v) as string[];
    const errs = Array.isArray(j["errors"]) ? (j["errors"] as Array<Record<string, unknown>>).map((e) => `${e["field"] ?? ""} ${e["message"] ?? ""}`.trim()).filter(Boolean) : [];
    const out = [...parts, ...errs].join("; ");
    if (out) return out.slice(0, 200);
  } catch { /* not JSON: fall through */ }
  return raw.replace(/\s+/g, " ").slice(0, 200);
}

export function classifyHttpError(status: number, retryAfterHeader: string | null, body?: string): ClassifiedError {
  const detail = (body ?? "").slice(0, 300);
  if (status === 429) {
    const secs = Number(retryAfterHeader);
    return { kind: "rate_limit", code: "ZENODO_RATE_LIMITED", retryable: true, retryAfterMs: Number.isFinite(secs) && secs > 0 ? Math.min(secs, 3600) * 1000 : 60_000, message: "Zenodo is rate limiting requests; the registration will be retried automatically" };
  }
  if (status === 401) return { kind: "auth", code: "ZENODO_AUTH_FAILED", retryable: false, retryAfterMs: null, message: `Zenodo says the access token is invalid, expired or not for this environment (HTTP 401: ${describeZenodoBody(body)}). Create a new token on the same Zenodo site as ZENODO_ENVIRONMENT, then redeploy.` };
  if (status === 403) return { kind: "auth", code: "ZENODO_AUTH_FAILED", retryable: false, retryAfterMs: null, message: `Zenodo refused the request (HTTP 403: ${describeZenodoBody(body)}). Either the token lacks the deposit:write / deposit:actions scopes, or Zenodo blocked the request itself.` };
  if (status === 404) return { kind: "not_found", code: "ZENODO_NOT_FOUND", retryable: false, retryAfterMs: null, message: "Zenodo could not find the requested record" };
  if (status === 409) return { kind: "conflict", code: "ZENODO_CONFLICT", retryable: false, retryAfterMs: null, message: `Zenodo reported a conflict: ${detail}` };
  if (status === 400 || status === 422) return { kind: "validation", code: "ZENODO_METADATA_REJECTED", retryable: false, retryAfterMs: null, message: `Zenodo rejected the metadata or file: ${detail}` };
  if (status >= 500) return { kind: "server", code: "ZENODO_SERVER_ERROR", retryable: true, retryAfterMs: null, message: `Zenodo had a server error (HTTP ${status})` };
  return { kind: "unknown", code: "ZENODO_UNEXPECTED_STATUS", retryable: false, retryAfterMs: null, message: `Unexpected response from Zenodo (HTTP ${status})` };
}
export const timeoutError = (): ClassifiedError => ({ kind: "timeout", code: "ZENODO_TIMEOUT", retryable: true, retryAfterMs: null, message: "Zenodo did not answer in time; the outcome is being reconciled before anything is repeated" });
export const networkError = (): ClassifiedError => ({ kind: "network", code: "ZENODO_NETWORK_ERROR", retryable: true, retryAfterMs: null, message: "Zenodo could not be reached" });

/** Exponential back-off with a cap; a Retry-After from Zenodo always wins. Deterministic (jitter injected) so it is testable. */
export function nextRetryDelayMs(attempt: number, retryAfterMs: number | null, jitter = Math.random()): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs;
  return Math.round(Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000) * (0.85 + 0.3 * jitter));
}
export const retriesExhausted = (attemptCount: number) => attemptCount >= MAX_ATTEMPTS;

const ALLOWED: Record<ZenodoWorkflowStatus, ZenodoWorkflowStatus[]> = {
  not_started: ["pending"],
  pending: ["uploading", "failed"],
  uploading: ["publishing", "failed", "pending"],
  publishing: ["registered", "failed", "uploading"],
  failed: ["pending", "uploading", "publishing", "registered"],
  registered: [],
};
export const workflowTransitionAllowed = (from: ZenodoWorkflowStatus, to: ZenodoWorkflowStatus) => from === to || ALLOWED[from].includes(to);

/** What the orchestrator must do next, given what is already recorded. A recorded deposit id is never replaced by a new create. */
export type NextStep = "create_deposit" | "reconcile_then_create" | "upload_file" | "publish" | "verify_published" | "done";
export function planNextStep(r: { workflowStatus: ZenodoWorkflowStatus; depositId: number | null; fileUploaded: boolean; createUncertain: boolean; publishUncertain: boolean }): NextStep {
  if (r.workflowStatus === "registered") return "done";
  if (r.depositId == null) return r.createUncertain ? "reconcile_then_create" : "create_deposit";
  if (r.publishUncertain) return "verify_published";
  return r.fileUploaded ? "publish" : "upload_file";
}

/** The certificate and article page show a DOI only for a completed registration. */
export function displayableDoi(rec: { status?: string | null; workflow_status?: string | null; doi?: string | null; zenodo_environment?: string | null } | null): { doi: string; href: string; sandbox: boolean } | null {
  if (!rec?.doi || rec.status !== "VERIFIED") return null;
  if (rec.workflow_status && rec.workflow_status !== "registered") return null;
  return { doi: rec.doi, href: doiHref(rec.doi), sandbox: rec.zenodo_environment === "sandbox" || isSandboxDoi(rec.doi) };
}

// ---------------------------------------------------------------- authorisation (enforced server-side in zenodo.server.ts)
export type ZenodoAction = "read" | "approve_publication" | "retry" | "update_metadata" | "configure" | "test_connection";
const ADMIN_ROLES = ["admin", "super_admin"];
const EDITOR_ROLES = ["editor", ...ADMIN_ROLES];
/** Editors may approve publication (the editorial act) and see status; retries, metadata changes, configuration and connection tests are administrator-only.
 *  Founders, reviewers, payment staff and authors have no Zenodo access. */
export function canZenodo(roles: readonly string[], action: ZenodoAction): boolean {
  const allowed = action === "read" || action === "approve_publication" ? EDITOR_ROLES : ADMIN_ROLES;
  return roles.some((r) => allowed.includes(r));
}
/** Conflict of interest: nobody approves publication of their own manuscript (mirrors adminPublish). */
export const mayApproveOwnPaper = (actorId: string, ownerId: string) => actorId !== ownerId;

/** The Zenodo workflow is active only when ZENODO_ENVIRONMENT names an environment; otherwise publication behaves as it did before. */
export const zenodoEnabledFor = (env: Record<string, string | undefined>) => ["sandbox", "production"].includes((env["ZENODO_ENVIRONMENT"] ?? "").trim().toLowerCase());
