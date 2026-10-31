// Zenodo DOI registration: database store, secrets, authorisation and wiring. Server-only (".server.ts"): secrets are read from process.env
// here and never returned to a client, logged, stored in the database or placed in an audit record.
import { audit, db, dbx, log } from "./core.server";
import { sha256Hex } from "@/lib/domain/file-security";
import { ZenodoClient, ZenodoError } from "@/lib/domain/zenodo-client";
import { runRegistration, type Outcome, type RecordPatch, type RegistrationRecord, type WorkflowDeps } from "@/lib/domain/zenodo-workflow";
import { buildAuthorizeUrl, decryptSecret, encryptSecret, exchangeCode, refreshTokens, signConnectState, tokenNeedsRefresh, verifyConnectState, zenodoOAuthConfig, ZenodoOAuthError } from "@/lib/domain/zenodo-oauth";
import { LEASE_SECONDS, zenodoEnabledFor, buildDepositMetadata, canZenodo, mayApproveOwnPaper, publicConfigStatus, redactSecret, resolveZenodoConfig, type ZenodoAction, type ZenodoPaperInput, type ZenodoWorkflowStatus } from "@/lib/domain/zenodo";

const BUCKET = "manuscripts";
type Row = Record<string, unknown>;
type DoiRegRow = { paper_id: string; workflow_status: string; zenodo_environment: string | null; doi: string | null; doi_url: string | null; record_url: string | null; zenodo_deposit_id: number | null; registered_at: string | null; last_error: string | null; last_error_code: string | null; attempt_count: number; next_retry_at: string | null; approved_at: string | null; updated_at: string };

/** The Zenodo workflow is active only when ZENODO_ENVIRONMENT is set. Without it, publication behaves exactly as before. */
export const zenodoEnabled = () => zenodoEnabledFor(process.env);

async function settings(): Promise<Row> {
  const { data } = await dbx.from("editorial_settings").select("*").eq("id", true).maybeSingle();
  return (data ?? {}) as Row;
}
// ---------------------------------------------------------------- OAuth connection ("Connect Zenodo")
// A token set in the environment (ZENODO_ACCESS_TOKEN / _SANDBOX / _PRODUCTION) always wins. Otherwise the token an administrator
// authorised through OAuth is used, refreshed shortly before it expires. Tokens are stored encrypted and never leave the server.
const OAUTH_TABLE = "zenodo_oauth_connection";
const envName = () => (process.env["ZENODO_ENVIRONMENT"] ?? "").trim().toLowerCase();
const oauthLog = (event: string, extra: Row = {}) => console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }));

async function oauthAccessToken(environment: "sandbox" | "production"): Promise<string | null> {
  const cfg = zenodoOAuthConfig(process.env);
  if (!cfg.ok) return null;
  const { data } = await dbx.from(OAUTH_TABLE).select("*").eq("id", true).maybeSingle();
  const row = data as Row | null;
  if (!row || row["environment"] !== environment) return null;
  const access = await decryptSecret(String(row["access_token_enc"]), cfg.encKey).catch(() => null);
  if (access && !tokenNeedsRefresh(row["expires_at"] as string | null)) return access;
  const refresh = row["refresh_token_enc"] ? await decryptSecret(String(row["refresh_token_enc"]), cfg.encKey).catch(() => null) : null;
  if (!refresh) return access; // no way to renew: Zenodo will answer 401 and the admin screen says to reconnect
  try {
    const t = await refreshTokens(fetch as never, environment, cfg, refresh);
    await dbx.from(OAUTH_TABLE).update({
      access_token_enc: await encryptSecret(t.accessToken, cfg.encKey),
      refresh_token_enc: t.refreshToken ? await encryptSecret(t.refreshToken, cfg.encKey) : row["refresh_token_enc"],
      expires_at: t.expiresAt, updated_at: new Date().toISOString(),
    }).eq("id", true);
    return t.accessToken;
  } catch (e) {
    oauthLog("zenodo_oauth_refresh_failed", { code: e instanceof ZenodoOAuthError ? e.code : "unknown" });
    return access;
  }
}
/** process.env, plus the OAuth access token when no token is set in the environment for the configured Zenodo environment. */
async function resolvedEnv(): Promise<Record<string, string | undefined>> {
  const raw = envName();
  if (raw !== "sandbox" && raw !== "production") return process.env;
  if (process.env[`ZENODO_ACCESS_TOKEN_${raw.toUpperCase()}`] || process.env["ZENODO_ACCESS_TOKEN"]) return process.env;
  const tok = await oauthAccessToken(raw);
  return tok ? { ...process.env, ZENODO_ACCESS_TOKEN: tok } : process.env;
}
async function oauthStatus() {
  const cfg = zenodoOAuthConfig(process.env);
  const raw = envName();
  const { data } = await dbx.from(OAUTH_TABLE).select("environment, connected_at, zenodo_user_name, expires_at").eq("id", true).maybeSingle();
  const row = data as Row | null;
  const connected = !!row && row["environment"] === raw;
  return { configured: cfg.ok, missing: cfg.ok ? [] : cfg.missing, connected, connectedAt: connected ? (row!["connected_at"] as string) : null, userName: connected ? ((row!["zenodo_user_name"] as string) ?? null) : null,
    otherEnvironment: !!row && !connected ? (row["environment"] as string) : null, envTokenSet: !!(process.env["ZENODO_ACCESS_TOKEN"] || process.env[`ZENODO_ACCESS_TOKEN_${raw.toUpperCase()}`]) };
}
async function config() { return resolveZenodoConfig(await resolvedEnv(), !!(await settings())["zenodo_production_enabled"]); }
export async function requireZenodoRole(userId: string, action: ZenodoAction) {
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role as string);
  if (!canZenodo(roles, action)) throw new Error("Forbidden: insufficient role");
  return roles;
}

// ---------------------------------------------------------------- store + loaders
const toRecord = (r: Row): RegistrationRecord => ({
  paperId: String(r["paper_id"]), workflowStatus: r["workflow_status"] as ZenodoWorkflowStatus, environment: r["zenodo_environment"] as "sandbox" | "production", idempotencyKey: String(r["idempotency_key"]),
  depositId: r["zenodo_deposit_id"] == null ? null : Number(r["zenodo_deposit_id"]), recordId: r["zenodo_record_id"] == null ? null : Number(r["zenodo_record_id"]),
  doi: (r["doi"] as string) ?? null, doiUrl: (r["doi_url"] as string) ?? null, recordUrl: (r["record_url"] as string) ?? null, fileUploaded: !!r["uploaded_at"], attemptCount: Number(r["attempt_count"] ?? 0), lastErrorCode: (r["last_error_code"] as string) ?? null,
});
const PUBLIC_STATUS: Record<ZenodoWorkflowStatus, string> = { not_started: "PENDING", pending: "PENDING", uploading: "REGISTERING", publishing: "REGISTERING", registered: "VERIFIED", failed: "FAILED" };

async function save(paperId: string, p: RecordPatch, env: string) {
  const u: Row = { updated_at: new Date().toISOString() };
  if (p.workflowStatus) { u["workflow_status"] = p.workflowStatus; u["status"] = PUBLIC_STATUS[p.workflowStatus]; }
  if (p.depositId != null) u["zenodo_deposit_id"] = p.depositId;
  if (p.recordId != null) u["zenodo_record_id"] = p.recordId;
  if (p.doi) u["doi"] = p.doi;
  if (p.doiUrl) u["doi_url"] = p.doiUrl;
  if (p.recordUrl) u["record_url"] = p.recordUrl;
  if (p.fileSha256) u["file_sha256"] = p.fileSha256;
  if (p.uploadedAt) u["uploaded_at"] = p.uploadedAt;
  if ("lastError" in p) { u["last_error"] = p.lastError ?? null; if (p.lastError) u["last_error_at"] = new Date().toISOString(); }
  if ("lastErrorCode" in p) u["last_error_code"] = p.lastErrorCode ?? null;
  if ("nextRetryAt" in p) u["next_retry_at"] = p.nextRetryAt ?? null;
  if (p.releaseLease) { u["lease_owner"] = null; u["lease_expires_at"] = null; }
  if (p.verified) { u["verified_at"] = new Date().toISOString(); u["registered_at"] = new Date().toISOString(); }
  const { error } = await dbx.from("doi_records").update(u).eq("paper_id", paperId);
  if (error) throw new Error(`doi_records update failed: ${redactSecret(error.message)}`);
  if (p.verified && env === "sandbox") await dbx.from("editorial_settings").update({ zenodo_sandbox_verified_at: new Date().toISOString() }).eq("id", true);
}

export async function loadInput(paperId: string, origin: string): Promise<ZenodoPaperInput> {
  const { data: p } = await db.from("papers").select("*").eq("id", paperId).maybeSingle();
  if (!p) throw new Error("Paper not found");
  const [{ data: authors }, { data: ver }, { data: rec }] = await Promise.all([
    db.from("paper_authors").select("full_name, affiliation, orcid, user_id").eq("paper_id", paperId).order("position"),
    p.current_version_id ? db.from("paper_versions").select("version_number, file_hash, storage_path").eq("id", p.current_version_id).maybeSingle() : Promise.resolve({ data: null }),
    dbx.from("doi_records").select("approved_at, approved_by").eq("paper_id", paperId).maybeSingle(),
  ]);
  // Only ORCID iDs the author proved through ORCID sign-in are deposited (same rule as the existing publication code).
  const uids = (authors ?? []).map((a) => a.user_id).filter((u): u is string => !!u);
  const { data: vv } = uids.length ? await db.from("orcid_verifications").select("user_id, orcid").in("user_id", uids) : { data: [] as Array<{ user_id: string; orcid: string }> };
  const vmap = new Map((vv ?? []).map((v) => [v.user_id, v.orcid]));
  let size = 0; let kind: "pdf" | "docx" | "other" = "other";
  if (ver?.storage_path) {
    kind = ver.storage_path.toLowerCase().endsWith(".pdf") ? "pdf" : ver.storage_path.toLowerCase().endsWith(".docx") ? "docx" : "other";
    const dir = ver.storage_path.split("/").slice(0, -1).join("/"); const name = ver.storage_path.split("/").pop();
    const { data: list } = await db.storage.from(BUCKET).list(dir, name ? { search: name } : {});
    size = Number(list?.find((f) => f.name === name)?.metadata?.size ?? 0);
  }
  return {
    paperlyId: p.paperly_id, title: p.title ?? "", abstract: p.abstract ?? "", keywords: p.keywords ?? [],
    authors: (authors ?? []).map((a) => ({ name: a.full_name, affiliation: a.affiliation, orcid: a.user_id && a.orcid && vmap.get(a.user_id) === a.orcid ? a.orcid : null })),
    publicationDate: (p.published_at ?? new Date().toISOString()).slice(0, 10), license: p.license, publicationType: (p as Row)["publication_type"] as string | null, articleUrl: `${origin}/article/${p.paperly_id}`,
    version: ver?.version_number ?? null, status: p.status, deleted: !!p.deleted_at, peerReviewed: !!p.peer_reviewed,
    file: ver?.storage_path ? { kind, sizeBytes: size, sha256Expected: ver.file_hash ?? null } : null,
    approval: { approvedAt: (rec?.approved_at as string) ?? null, approvedBy: (rec?.approved_by as string) ?? null },
  };
}

async function loadFile(paperId: string) {
  const { data: p } = await db.from("papers").select("paperly_id, current_version_id").eq("id", paperId).single();
  const { data: ver } = await db.from("paper_versions").select("storage_path, uploaded_at").eq("id", p!.current_version_id!).single();
  const f = await db.storage.from(BUCKET).download(ver!.storage_path);
  if (f.error || !f.data) throw new Error("The final manuscript could not be read from storage");
  const stored = new Uint8Array(await f.data.arrayBuffer());
  const filename = `${p!.paperly_id}.pdf`;
  if (!ver!.storage_path.toLowerCase().endsWith(".docx")) return { bytes: stored, filename, sha256: await sha256Hex(stored) };
  // Zenodo takes a PDF: convert the Word manuscript. The dates come from the version, so a retry produces the same file and the
  // "already uploaded" check in the workflow still recognises it.
  const input = await loadInput(paperId, "");
  const { docxToHtml } = await import("@/lib/domain/docx-html");
  const { renderDocxAsPdf } = await import("@/lib/domain/article-stamp");
  let blocks;
  try { blocks = (await docxToHtml(stored)).blocks; } catch { throw new Error("The Word manuscript could not be read to convert it to PDF"); }
  const bytes = await renderDocxAsPdf({
    paperlyId: input.paperlyId, legacyId: null, title: input.title, authors: input.authors.map((a) => ({ name: a.name, orcid: a.orcid ?? null, affiliation: a.affiliation ?? null })),
    doi: null, version: input.version ?? "1", versionIdentifier: null, fileSha256: input.file?.sha256Expected ?? "", publishedAt: null, status: input.status, recordType: "", reviewStatement: "",
    license: input.license, articleUrl: input.articleUrl, citation: null, certificates: [], generatedAt: (ver!.uploaded_at as string | null) ?? "2000-01-01T00:00:00Z", sourceKind: "docx",
  }, blocks);
  return { bytes, filename, sha256: await sha256Hex(bytes), sourceSha256: await sha256Hex(stored) };
}

async function makeDeps(origin: string, actorId: string | null): Promise<WorkflowDeps> {
  const cfg = await config();
  if (!cfg.ok) throw new Error(cfg.message);
  const { publishPaper } = await import("./pipeline.server");
  const { certificateSiteUrl } = await import("./core.server");
  return {
    client: new ZenodoClient({ baseUrl: cfg.baseUrl, token: cfg.token, fetch: fetch as never }), environment: cfg.environment, token: cfg.token,
    async claim(paperId, owner, force) { const { data, error } = await dbx.rpc("zenodo_claim_registration", { _paper_id: paperId, _owner: owner, _lease_seconds: LEASE_SECONDS, _force: force }); if (error) throw new Error(error.message); const r = data as Row | null; return r && r["id"] ? toRecord(r) : null; },
    save: (paperId, patch) => save(paperId, patch, cfg.environment),
    loadInput: (paperId) => loadInput(paperId, certificateSiteUrl(origin)),
    loadFile,
    async audit(action, paperId, metadata) { await audit({ actor_id: actorId, actor_type: actorId ? "USER" : "SYSTEM", action, resource_type: "paper", resource_id: paperId, metadata: { ...metadata, provider: "zenodo" } }); },
    async onRegistered(paperId) { await finishPublication(paperId, actorId, origin, publishPaper); },
  };
}

/** After a confirmed DOI exists: mirror it onto the paper and run the normal publication (status, certificates, e-mails). Safe to repeat. */
async function finishPublication(paperId: string, actorId: string | null, origin: string, publish?: (id: string, actor: string | null, origin: string) => Promise<void>) {
  const { data: rec } = await dbx.from("doi_records").select("doi, workflow_status").eq("paper_id", paperId).maybeSingle();
  if (rec?.workflow_status !== "registered" || !rec.doi) throw new Error("No registered DOI");
  await db.from("papers").update({ doi: rec.doi }).eq("id", paperId);
  const { data: p } = await db.from("papers").select("status").eq("id", paperId).single();
  if (p?.status === "PUBLICATION_PENDING") await (publish ?? (await import("./pipeline.server")).publishPaper)(paperId, actorId, origin);
}

// ---------------------------------------------------------------- operations used by server functions
/** Explicit publication approval by an authorised editor, then registration. Never throws for workflow failures: they are recorded on the record. */
export async function approveAndRegister(paperId: string, actorId: string, origin: string): Promise<Outcome | { outcome: "not_configured"; code: string; message: string }> {
  await requireZenodoRole(actorId, "approve_publication");
  const cfg = await config();
  if (!cfg.ok) return { outcome: "not_configured", code: cfg.code, message: cfg.message };
  const { data: p } = await db.from("papers").select("owner_id, status, deleted_at").eq("id", paperId).maybeSingle();
  if (!p || p.deleted_at) throw new Error("Paper not found");
  if (!mayApproveOwnPaper(actorId, p.owner_id)) throw new Error("Conflict of interest: you cannot publish your own manuscript");
  const { error } = await dbx.rpc("zenodo_approve_publication", { _paper_id: paperId, _actor: actorId, _env: cfg.environment });
  if (error) throw new Error(error.message);
  await audit({ actor_id: actorId, action: "publication_approved", resource_type: "paper", resource_id: paperId, metadata: { provider: "zenodo", environment: cfg.environment } });
  return runRegistration(await makeDeps(origin, actorId), paperId, `user:${actorId}:${Date.now()}`);
}

/** Administrator retry of a failed registration: resets the attempt budget and resumes the same deposit (never a new one). */
export async function retryRegistration(paperId: string, actorId: string, origin: string): Promise<Outcome> {
  await requireZenodoRole(actorId, "retry");
  const { data: rec } = await dbx.from("doi_records").select("workflow_status, approved_at").eq("paper_id", paperId).maybeSingle();
  if (!rec?.approved_at) throw new Error("Publication has not been approved for this paper");
  if (rec.workflow_status === "registered") throw new Error("This paper already has a registered DOI");
  await dbx.from("doi_records").update({ attempt_count: 0, next_retry_at: null }).eq("paper_id", paperId);
  await audit({ actor_id: actorId, action: "doi_retry_requested", resource_type: "paper", resource_id: paperId, metadata: { provider: "zenodo" } });
  return runRegistration(await makeDeps(origin, actorId), paperId, `admin:${actorId}:${Date.now()}`, { force: true });
}

/** Scheduled sweep: resumes retryable registrations that are due, and finishes publication for registrations whose last step failed. Counts only. */
export async function sweepZenodo(origin: string, limit = 5) {
  if (!zenodoEnabled()) return { due: 0, registered: 0, failed: 0, finished: 0 };
  const nowIso = new Date().toISOString();
  const { data } = await dbx.from("doi_records").select("paper_id, workflow_status, next_retry_at").not("approved_at", "is", null).neq("workflow_status", "registered").neq("workflow_status", "not_started")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`).or(`lease_expires_at.is.null,lease_expires_at.lt.${nowIso}`).limit(limit);
  let registered = 0, failed = 0;
  for (const r of (data ?? []) as Array<{ paper_id: string; next_retry_at: string | null }>) {
    if (r.next_retry_at === "infinity") continue; // permanent failure: administrator retry only
    try { const o = await runRegistration(await makeDeps(origin, null), r.paper_id, `sweep:${Date.now()}`); if (o.outcome === "registered") registered++; else if (o.outcome === "failed") failed++; } catch (e) { failed++; log("zenodo_sweep_error", { paper_id: r.paper_id, error: redactSecret(e instanceof Error ? e.message : "unknown") }); }
  }
  const { data: stuck } = await dbx.from("doi_records").select("paper_id").eq("workflow_status", "registered").limit(limit);
  let finished = 0;
  for (const s of (stuck ?? []) as Array<{ paper_id: string }>) { const { data: p } = await db.from("papers").select("status").eq("id", s.paper_id).single(); if (p?.status === "PUBLICATION_PENDING") { try { await finishPublication(s.paper_id, null, origin); finished++; } catch { /* reported in the admin list */ } } }
  return { due: (data ?? []).length, registered, failed, finished };
}

/** Public and secret-free, for the "DOI" badge beside ORCID on the site header and About page. It is true only when a Zenodo environment is set,
 *  a token exists, the last administrator connection test for that same environment succeeded, and (for production) the admin switch is on. */
export async function publicDoiStatus(): Promise<{ live: boolean; sandbox: boolean }> {
  const raw = envName();
  if (raw !== "sandbox" && raw !== "production") return { live: false, sandbox: false };
  try {
    const s = await settings();
    const envToken = !!(process.env[`ZENODO_ACCESS_TOKEN_${raw.toUpperCase()}`] || process.env["ZENODO_ACCESS_TOKEN"]);
    const tokenPresent = envToken || (await oauthStatus()).connected;
    const tested = !!s["zenodo_last_test_ok"] && String(s["zenodo_last_test_env"] ?? "") === raw;
    const allowed = raw === "sandbox" || !!s["zenodo_production_enabled"];
    return { live: tokenPresent && tested && allowed, sandbox: raw === "sandbox" };
  } catch { return { live: false, sandbox: raw === "sandbox" }; }
}

export async function zenodoStatus(actorId: string) {
  const roles = await requireZenodoRole(actorId, "read");
  const s = await settings(); const oauth = await oauthStatus();
  // Only the shape matters here: a stand-in value lets the status say "token present" when the token comes from OAuth. It is never sent anywhere.
  const cfg = publicConfigStatus(oauth.connected && !oauth.envTokenSet ? { ...process.env, ZENODO_ACCESS_TOKEN: "oauth" } : process.env, !!s["zenodo_production_enabled"]);
  return { canAdmin: canZenodo(roles, "retry"), config: cfg, oauth, productionEnabled: !!s["zenodo_production_enabled"], sandboxVerifiedAt: (s["zenodo_sandbox_verified_at"] as string) ?? null,
    lastTest: s["zenodo_last_test_at"] ? { at: s["zenodo_last_test_at"] as string, env: s["zenodo_last_test_env"] as string, ok: !!s["zenodo_last_test_ok"], message: s["zenodo_last_test_message"] as string } : null };
}

export async function testConnection(actorId: string) {
  await requireZenodoRole(actorId, "test_connection");
  // The connection test always targets the configured environment. It reads only; it never creates a deposit.
  const raw = (process.env["ZENODO_ENVIRONMENT"] ?? "").trim().toLowerCase();
  const cfg = resolveZenodoConfig(await resolvedEnv(), true);
  let ok = false; let message = cfg.ok ? "" : cfg.message;
  if (cfg.ok) { try { await new ZenodoClient({ baseUrl: cfg.baseUrl, token: cfg.token, fetch: fetch as never }).testConnection(); ok = true; message = `Connected to Zenodo ${cfg.environment}`; } catch (e) { message = e instanceof ZenodoError ? e.info.message : "Zenodo could not be reached"; } }
  await dbx.from("editorial_settings").update({ zenodo_last_test_at: new Date().toISOString(), zenodo_last_test_env: raw || null, zenodo_last_test_ok: ok, zenodo_last_test_message: redactSecret(message, cfg.ok ? cfg.token : undefined).slice(0, 300) }).eq("id", true);
  await audit({ actor_id: actorId, action: "zenodo_connection_tested", resource_type: "settings", metadata: { environment: raw, ok } });
  return { ok, message };
}

/** Production is an explicit admin switch (audited). A sandbox test is recommended but no longer required. */
export async function setProductionEnabled(actorId: string, enabled: boolean) {
  await requireZenodoRole(actorId, "configure");
  await dbx.from("editorial_settings").update({ zenodo_production_enabled: enabled, updated_by: actorId, updated_at: new Date().toISOString() }).eq("id", true);
  await audit({ actor_id: actorId, action: enabled ? "zenodo_production_enabled" : "zenodo_production_disabled", resource_type: "settings" });
}

export async function listRegistrations(actorId: string) {
  await requireZenodoRole(actorId, "read");
  const { data: recs } = await dbx.from("doi_records").select("paper_id, workflow_status, zenodo_environment, doi, doi_url, record_url, zenodo_deposit_id, registered_at, last_error, last_error_code, attempt_count, next_retry_at, approved_at, updated_at").neq("workflow_status", "not_started").order("updated_at", { ascending: false }).limit(100);
  const regs = (recs ?? []) as unknown as DoiRegRow[];
  const ids = regs.map((r) => r.paper_id);
  const { data: papers } = ids.length ? await db.from("papers").select("id, title, paperly_id, status").in("id", ids) : { data: [] as Array<{ id: string; title: string; paperly_id: string; status: string }> };
  const pm = new Map((papers ?? []).map((p) => [p.id, p]));
  const { data: waiting } = await db.from("papers").select("id, title, paperly_id").eq("status", "PUBLICATION_PENDING").is("deleted_at", null).limit(50);
  const have = new Set(ids);
  return {
    rows: regs.map((r) => ({ ...r, paper: pm.get(r.paper_id) ?? null, retryExhausted: r.next_retry_at === "infinity" })),
    awaitingApproval: (waiting ?? []).filter((p) => !have.has(p.id)),
  };
}

/** Metadata correction for an already registered record: re-opens the same Zenodo record, updates it and re-publishes. Same DOI, no new deposit. */
export async function updatePublishedMetadata(paperId: string, actorId: string, origin: string) {
  await requireZenodoRole(actorId, "update_metadata");
  const cfg = await config(); if (!cfg.ok) throw new Error(cfg.message);
  const { data: rec } = await dbx.from("doi_records").select("workflow_status, zenodo_deposit_id, idempotency_key, zenodo_environment").eq("paper_id", paperId).maybeSingle();
  if (rec?.workflow_status !== "registered" || !rec.zenodo_deposit_id) throw new Error("Only a registered record can have its metadata updated");
  if (rec.zenodo_environment !== cfg.environment) throw new Error("This record belongs to a different Zenodo environment than the one configured");
  const { certificateSiteUrl } = await import("./core.server");
  const input = await loadInput(paperId, certificateSiteUrl(origin));
  input.status = "PUBLICATION_PENDING"; input.approval = { approvedAt: "x", approvedBy: actorId }; // readiness is judged on the registered record; content checks still apply
  const meta = buildDepositMetadata(input, String(rec.idempotency_key));
  const client = new ZenodoClient({ baseUrl: cfg.baseUrl, token: cfg.token, fetch: fetch as never });
  const id = Number(rec.zenodo_deposit_id);
  await client.edit(id); await client.updateMetadata(id, meta); await client.publish(id);
  await audit({ actor_id: actorId, action: "doi_metadata_updated", resource_type: "paper", resource_id: paperId, metadata: { provider: "zenodo", deposit_id: id } });
}

// ---------------------------------------------------------------- connect / disconnect (administrators only)
export async function connectUrl(actorId: string, redirectUri: string) {
  await requireZenodoRole(actorId, "configure");
  const raw = envName();
  if (raw !== "sandbox" && raw !== "production") throw new Error("Set ZENODO_ENVIRONMENT to sandbox or production before connecting Zenodo");
  const cfg = zenodoOAuthConfig(process.env);
  if (!cfg.ok) throw new Error(`Zenodo sign-in is not configured: set ${cfg.missing.join(" and ")} on the server, then redeploy`);
  return buildAuthorizeUrl(raw, cfg.clientId, redirectUri, await signConnectState(actorId, cfg));
}

/** Called from the signed-in callback page. The state must have been issued to THIS administrator. */
export async function completeConnect(actorId: string, code: string, state: string, redirectUri: string) {
  await requireZenodoRole(actorId, "configure");
  const raw = envName();
  if (raw !== "sandbox" && raw !== "production") throw new Error("Set ZENODO_ENVIRONMENT to sandbox or production before connecting Zenodo");
  const cfg = zenodoOAuthConfig(process.env);
  if (!cfg.ok) throw new Error(`Zenodo sign-in is not configured: set ${cfg.missing.join(" and ")} on the server, then redeploy`);
  const st = await verifyConnectState(state, cfg);
  if (!st || st.uid !== actorId) throw new Error("This Zenodo link is invalid, expired, or was started from a different account. Press Connect Zenodo again.");
  let t;
  try { t = await exchangeCode(fetch as never, raw, cfg, code, redirectUri); }
  catch (e) { oauthLog("zenodo_oauth_exchange_failed", { code: e instanceof ZenodoOAuthError ? e.code : "unknown", redirect_uri: redirectUri }); throw e instanceof ZenodoOAuthError ? new Error(e.message) : new Error("Zenodo did not accept the sign-in. Please try again."); }
  const now = new Date().toISOString();
  const { error } = await dbx.from(OAUTH_TABLE).upsert({
    id: true, environment: raw, access_token_enc: await encryptSecret(t.accessToken, cfg.encKey), refresh_token_enc: t.refreshToken ? await encryptSecret(t.refreshToken, cfg.encKey) : null,
    expires_at: t.expiresAt, scope: t.scope, zenodo_user_id: t.userId, zenodo_user_name: t.userName, connected_by: actorId, connected_at: now, updated_at: now,
  }, { onConflict: "id" });
  if (error) { oauthLog("zenodo_oauth_save_failed", { message: redactSecret(error.message).slice(0, 200) }); throw new Error("Could not save the Zenodo connection"); }
  await audit({ actor_id: actorId, action: "zenodo_oauth_connected", resource_type: "settings", metadata: { environment: raw, zenodo_user: t.userName, scope: t.scope } });
  return { ok: true, environment: raw, userName: t.userName, hasRefreshToken: !!t.refreshToken };
}

export async function disconnect(actorId: string) {
  await requireZenodoRole(actorId, "configure");
  await dbx.from(OAUTH_TABLE).delete().eq("id", true);
  await audit({ actor_id: actorId, action: "zenodo_oauth_disconnected", resource_type: "settings" });
}
