import { describe, expect, it } from "vitest";
import { ZenodoClient, type FetchLike } from "./zenodo-client";
import { runRegistration, type RecordPatch, type RegistrationRecord, type WorkflowDeps } from "./zenodo-workflow";
import {
  buildDepositMetadata, canZenodo, creatorName, mayApproveOwnPaper, displayableDoi, nextRetryDelayMs, planNextStep, publicConfigStatus, redactSecret, resolveZenodoConfig,
  validateConfirmedDoi, validateForDeposit, workflowTransitionAllowed, classifyHttpError, type ZenodoPaperInput,
} from "./zenodo";

const TOKEN = "tok_SECRET_1234567890abcdef";
const good = (o: Partial<ZenodoPaperInput> = {}): ZenodoPaperInput => ({
  paperlyId: "PLY-2026-000001", title: "A study of cats", abstract: "Cats <are> great.\n\nReally.", keywords: ["cats", "study"],
  authors: [{ name: "Ada Lovelace", affiliation: "Analytical Engines Ltd", orcid: "0000-0002-1825-0097" }, { name: "Turing, Alan" }],
  publicationDate: "2026-10-12", license: "CC-BY", publicationType: "PREPRINT", articleUrl: "https://paperly.example/article/PLY-2026-000001", version: "1.0",
  status: "PUBLICATION_PENDING", deleted: false, peerReviewed: true,
  file: { kind: "pdf", sizeBytes: 5, sha256Expected: "abc" }, approval: { approvedAt: "2026-10-12T00:00:00Z", approvedBy: "u-editor" }, ...o,
});

describe("config and secrets", () => {
  it("separates sandbox and production tokens and base URLs", () => {
    const sb = resolveZenodoConfig({ ZENODO_ENVIRONMENT: "sandbox", ZENODO_ACCESS_TOKEN_SANDBOX: "sbtok123456", ZENODO_ACCESS_TOKEN_PRODUCTION: "prodtok123456" }, false);
    expect(sb).toMatchObject({ ok: true, environment: "sandbox", baseUrl: "https://sandbox.zenodo.org/api", token: "sbtok123456" });
    const pr = resolveZenodoConfig({ ZENODO_ENVIRONMENT: "production", ZENODO_ACCESS_TOKEN_SANDBOX: "sbtok123456", ZENODO_ACCESS_TOKEN_PRODUCTION: "prodtok123456" }, true);
    expect(pr).toMatchObject({ ok: true, environment: "production", baseUrl: "https://zenodo.org/api", token: "prodtok123456" });
  });
  it("never uses the sandbox token for production and keeps production off until enabled", () => {
    expect(resolveZenodoConfig({ ZENODO_ENVIRONMENT: "production", ZENODO_ACCESS_TOKEN_SANDBOX: "sbtok123456" }, true)).toMatchObject({ ok: false, code: "ZENODO_TOKEN_MISSING" });
    expect(resolveZenodoConfig({ ZENODO_ENVIRONMENT: "production", ZENODO_ACCESS_TOKEN: "t123456789" }, false)).toMatchObject({ ok: false, code: "ZENODO_PRODUCTION_DISABLED" });
    expect(resolveZenodoConfig({ ZENODO_ENVIRONMENT: "staging", ZENODO_ACCESS_TOKEN: "t123456789" }, true)).toMatchObject({ ok: false, code: "ZENODO_ENV_INVALID" });
  });
  it("the admin status never contains the token; redaction removes it from messages", () => {
    const s = JSON.stringify(publicConfigStatus({ ZENODO_ENVIRONMENT: "sandbox", ZENODO_ACCESS_TOKEN: TOKEN }, false));
    expect(s).not.toContain(TOKEN); expect(s).toContain("\"tokenPresent\":true");
    expect(redactSecret(`failed with ${TOKEN} and Bearer abcdefghijklmnop12`, TOKEN)).not.toMatch(/SECRET|abcdefghijklmnop/);
  });
});

describe("validation and metadata", () => {
  it("accepts a complete, approved, accepted paper", () => expect(validateForDeposit(good())).toEqual([]));
  it("rejects invalid metadata with specific codes", () => {
    const codes = (p: Partial<ZenodoPaperInput>) => validateForDeposit(good(p)).map((i) => i.code);
    expect(codes({ title: " " })).toContain("TITLE_MISSING");
    expect(codes({ abstract: "" })).toContain("ABSTRACT_MISSING");
    expect(codes({ authors: [] })).toContain("AUTHORS_MISSING");
    expect(codes({ authors: [{ name: "X", orcid: "1234" }] })).toContain("ORCID_INVALID");
    expect(codes({ publicationDate: "12/10/2026" })).toContain("DATE_INVALID");
    expect(codes({ license: "ALL-RIGHTS-RESERVED" })).toContain("LICENSE_NOT_OPEN");
    expect(codes({ file: null })).toContain("FILE_MISSING");
    expect(codes({ file: { kind: "docx", sizeBytes: 10, sha256Expected: null } })).not.toContain("FILE_NOT_PDF"); // Word is converted to PDF before deposit
    expect(codes({ file: { kind: "other", sizeBytes: 10, sha256Expected: null } })).toContain("FILE_NOT_PDF");
    expect(codes({ file: { kind: "pdf", sizeBytes: 0, sha256Expected: null } })).toContain("FILE_EMPTY");
  });
  it("requires explicit approval and publication readiness", () => {
    expect(validateForDeposit(good({ approval: { approvedAt: null, approvedBy: null } })).map((i) => i.code)).toContain("NOT_APPROVED");
    for (const status of ["REVIEW_REQUIRED", "ACCEPTED", "PEER_REVIEW", "PUBLISHED"]) expect(validateForDeposit(good({ status })).map((i) => i.code)).toContain("NOT_PUBLICATION_READY");
    expect(validateForDeposit(good({ deleted: true })).map((i) => i.code)).toContain("NOT_PUBLICATION_READY");
  });
  it("builds accurate Zenodo metadata without peer-review or indexing claims", () => {
    const m = buildDepositMetadata(good(), "key-1");
    expect(m).toMatchObject({ upload_type: "publication", publication_type: "preprint", access_right: "open", license: "cc-by-4.0", title: "A study of cats", publication_date: "2026-10-12", prereserve_doi: false });
    expect(m.creators[0]).toEqual({ name: "Lovelace, Ada", affiliation: "Analytical Engines Ltd", orcid: "0000-0002-1825-0097" });
    expect(m.creators[1]).toEqual({ name: "Turing, Alan" });
    expect(m.description).toContain("&lt;are&gt;"); expect(m.description).toContain("</p><p>");
    expect(m.related_identifiers[0]).toMatchObject({ identifier: "https://paperly.example/article/PLY-2026-000001", scheme: "url" });
    expect(m.notes).toBe("paperly-idempotency:key-1");
    expect(JSON.stringify(m).toLowerCase()).not.toMatch(/impact factor|indexed|accredit/);
    expect(creatorName("Mary Jane Watson")).toBe("Watson, Mary Jane");
  });
});

describe("DOI confirmation", () => {
  const pub = (o: Record<string, unknown> = {}) => ({ id: 77, submitted: true, state: "done", doi: "10.5072/zenodo.77", links: { record_html: "https://sandbox.zenodo.org/records/77" }, ...o });
  it("accepts only a published record with the right prefix and host", () => {
    expect(validateConfirmedDoi(pub(), "sandbox", 77)).toMatchObject({ ok: true, doi: "10.5072/zenodo.77", doiUrl: "https://doi.org/10.5072/zenodo.77", recordUrl: "https://sandbox.zenodo.org/records/77" });
    expect(validateConfirmedDoi(pub({ submitted: false, state: "unsubmitted" }), "sandbox").ok).toBe(false);
    expect(validateConfirmedDoi(pub({ doi: "" }), "sandbox").ok).toBe(false);
    expect(validateConfirmedDoi(pub({ doi: "10.5281/zenodo.77" }), "sandbox").ok).toBe(false);
    expect(validateConfirmedDoi(pub(), "production").ok).toBe(false);
    expect(validateConfirmedDoi(pub({ links: { record_html: "https://evil.example/records/77" } }), "sandbox").ok).toBe(false);
    expect(validateConfirmedDoi(pub({ id: 78 }), "sandbox", 77).ok).toBe(false);
    expect(validateConfirmedDoi(pub({ doi: "10.5072/x", submitted: false }), "sandbox").ok).toBe(false); // reserved/pending DOI is never "registered"
  });
  it("displays a DOI only for a verified, registered record", () => {
    expect(displayableDoi({ status: "VERIFIED", workflow_status: "registered", doi: "10.5072/z.1", zenodo_environment: "sandbox" })).toMatchObject({ href: "https://doi.org/10.5072/z.1", sandbox: true });
    expect(displayableDoi({ status: "PENDING", workflow_status: "publishing", doi: "10.5072/z.1" })).toBeNull();
    expect(displayableDoi({ status: "VERIFIED", workflow_status: "failed", doi: "10.5072/z.1" })).toBeNull();
    expect(displayableDoi(null)).toBeNull();
  });
});

describe("retry policy", () => {
  it("classifies errors", () => {
    expect(classifyHttpError(429, "12", "")).toMatchObject({ kind: "rate_limit", retryable: true, retryAfterMs: 12000 });
    expect(classifyHttpError(503, null)).toMatchObject({ retryable: true });
    expect(classifyHttpError(401, null)).toMatchObject({ code: "ZENODO_AUTH_FAILED", retryable: false });
    expect(classifyHttpError(400, null, "bad")).toMatchObject({ code: "ZENODO_METADATA_REJECTED", retryable: false });
  });
  it("backs off exponentially, bounded, honouring Retry-After", () => {
    expect(nextRetryDelayMs(1, null, 0.5)).toBe(30_000); expect(nextRetryDelayMs(2, null, 0.5)).toBe(60_000);
    expect(nextRetryDelayMs(30, null, 0.5)).toBe(30 * 60_000); expect(nextRetryDelayMs(1, 7000, 0.5)).toBe(7000);
  });
  it("state machine: registered is terminal; failed can resume", () => {
    expect(workflowTransitionAllowed("registered", "pending")).toBe(false);
    expect(workflowTransitionAllowed("failed", "publishing")).toBe(true);
    expect(workflowTransitionAllowed("not_started", "registered")).toBe(false);
  });
  it("never plans a second create when a deposit id exists or the create is uncertain", () => {
    const base = { workflowStatus: "failed" as const, fileUploaded: false, publishUncertain: false };
    expect(planNextStep({ ...base, depositId: 5, createUncertain: false })).toBe("upload_file");
    expect(planNextStep({ ...base, depositId: null, createUncertain: true })).toBe("reconcile_then_create");
    expect(planNextStep({ ...base, depositId: 5, createUncertain: false, fileUploaded: true })).toBe("publish");
    expect(planNextStep({ ...base, depositId: 5, createUncertain: false, publishUncertain: true })).toBe("verify_published");
  });
});

describe("authorisation", () => {
  it("editors approve and read; only administrators retry, change metadata, configure or test the connection", () => {
    expect(canZenodo(["editor"], "approve_publication")).toBe(true); expect(canZenodo(["editor"], "read")).toBe(true);
    for (const a of ["retry", "update_metadata", "configure", "test_connection"] as const) { expect(canZenodo(["editor"], a)).toBe(false); expect(canZenodo(["admin"], a)).toBe(true); expect(canZenodo(["super_admin"], a)).toBe(true); }
    for (const r of ["researcher", "reviewer", "founder", "payment_admin", "ethics_reviewer"]) for (const a of ["read", "approve_publication", "retry", "configure"] as const) expect(canZenodo([r], a)).toBe(false);
    expect(canZenodo([], "read")).toBe(false);
  });
  it("nobody approves publication of their own manuscript", () => { expect(mayApproveOwnPaper("u1", "u1")).toBe(false); expect(mayApproveOwnPaper("u1", "u2")).toBe(true); });
});

// ------------------------------------------------------------------ workflow against a stateful fake Zenodo + in-memory store
type Fault = "timeout" | "http500" | "http429" | "http400" | null;
function fakeZenodo(env: "sandbox" | "production" = "sandbox") {
  const host = env === "sandbox" ? "https://sandbox.zenodo.org" : "https://zenodo.org";
  const prefix = env === "sandbox" ? "10.5072" : "10.5281";
  const deps = new Map<number, { id: number; state: string; submitted: boolean; metadata: { notes?: string }; files: Array<{ filename: string; filesize: number }>; doi?: string }>();
  const calls: string[] = []; const faults: Record<string, Fault[]> = {}; let seq = 100; const tokens = new Set<string>();
  const res = (status: number, body: unknown, h: Record<string, string> = {}) => ({ ok: status < 400, status, headers: { get: (n: string) => h[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });
  const view = (d: { id: number; state: string; submitted: boolean; metadata: { notes?: string }; files: Array<{ filename: string; filesize: number }>; doi?: string }) => ({ ...d, links: { bucket: `${host}/api/files/bucket-${d.id}`, record_html: `${host}/records/${d.id}` } });
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET"; const path = url.replace(host, ""); const key = `${method} ${path.replace(/\d+/g, "N").replace(/\?.*/, "")}`;
    calls.push(key); tokens.add(init?.headers?.["Authorization"] ?? "");
    const f = faults[key]?.shift();
    if (f === "timeout") { await new Promise((r) => setTimeout(r, 1)); const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    if (f === "http500") return res(500, { message: "boom" }); if (f === "http429") return res(429, {}, { "retry-after": "5" }); if (f === "http400") return res(400, { message: "invalid metadata" });
    await new Promise((r) => setTimeout(r, 2));
    if (method === "POST" && path === "/api/deposit/depositions") { const id = ++seq; const m = JSON.parse(String(init?.body)).metadata; deps.set(id, { id, state: "unsubmitted", submitted: false, metadata: { notes: m.notes }, files: [] }); return res(201, view(deps.get(id)!)); }
    if (method === "GET" && path.startsWith("/api/deposit/depositions?")) return res(200, [...deps.values()].filter((d) => path.includes(d.submitted ? "published" : "draft")).map(view));
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/api\/deposit\/depositions\/(\d+)\/actions\/publish$/))) { const d = deps.get(+m[1]!)!; if (!d.files.length) return res(400, { message: "no files" }); d.submitted = true; d.state = "done"; d.doi = `${prefix}/zenodo.${d.id}`; return res(202, view(d)); }
    if ((m = path.match(/^\/api\/deposit\/depositions\/(\d+)$/))) { const d = deps.get(+m[1]!); if (!d) return res(404, {}); return res(200, view(d)); }
    if ((m = path.match(/^\/api\/files\/bucket-(\d+)\/(.+)$/))) { const d = deps.get(+m[1]!)!; d.files = [{ filename: decodeURIComponent(m[2]!), filesize: (init!.body as Uint8Array).byteLength }]; return res(201, { key: m[2]! }); }
    return res(404, {});
  };
  return { fetch, deps, calls, faults, tokens, count: (k: string) => calls.filter((c) => c === k).length };
}

function harness(opts: { input?: Partial<ZenodoPaperInput>; env?: "sandbox" | "production"; fileHash?: string } = {}) {
  const env = opts.env ?? "sandbox"; const z = fakeZenodo(env);
  const row: RegistrationRecord & { lease: string | null; nextRetryAt: string | null } = { paperId: "p1", workflowStatus: "pending", environment: env, idempotencyKey: "11111111-1111-1111-1111-111111111111", depositId: null, recordId: null, doi: null, doiUrl: null, recordUrl: null, fileUploaded: false, attemptCount: 0, lastErrorCode: null, lease: null, nextRetryAt: null };
  const audits: Array<{ action: string; meta: Record<string, unknown> }> = []; const registeredCalls: string[] = []; const paper = { doi: null as string | null, status: "PUBLICATION_PENDING" };
  const d: WorkflowDeps = {
    client: new ZenodoClient({ baseUrl: `${env === "sandbox" ? "https://sandbox.zenodo.org" : "https://zenodo.org"}/api`, token: TOKEN, fetch: z.fetch }), environment: env, token: TOKEN,
    async claim(_p, owner, force) { // mirrors zenodo_claim_registration(): one atomic check-and-set
      if (row.workflowStatus === "registered" || row.lease || (!force && row.nextRetryAt && (row.nextRetryAt === "infinity" || Date.parse(row.nextRetryAt) > Date.now()))) return null;
      row.lease = owner; row.attemptCount += 1; return { ...row };
    },
    async save(_p, patch: RecordPatch) {
      if (patch.workflowStatus) row.workflowStatus = patch.workflowStatus; if (patch.depositId != null) row.depositId = patch.depositId; if (patch.doi) row.doi = patch.doi; if (patch.doiUrl) row.doiUrl = patch.doiUrl; if (patch.recordUrl) row.recordUrl = patch.recordUrl;
      if (patch.recordId) row.recordId = patch.recordId; if (patch.uploadedAt) row.fileUploaded = true; if ("lastErrorCode" in patch) row.lastErrorCode = patch.lastErrorCode ?? null; if ("nextRetryAt" in patch) row.nextRetryAt = patch.nextRetryAt ?? null; if (patch.releaseLease) row.lease = null;
    },
    async loadInput() { return good({ file: { kind: "pdf", sizeBytes: 5, sha256Expected: "abc" }, ...opts.input }); },
    async loadFile() { return { bytes: new Uint8Array([1, 2, 3, 4, 5]), filename: "PLY-2026-000001.pdf", sha256: opts.fileHash ?? "abc" }; },
    async audit(action, _p, meta) { audits.push({ action, meta }); },
    async onRegistered(_p, r) { registeredCalls.push(r.doi); paper.doi = r.doi; paper.status = "PUBLISHED"; },
  };
  return { z, row, d, audits, registeredCalls, paper, retry: () => { row.attemptCount = 0; row.nextRetryAt = null; } };
}

describe("registration workflow", () => {
  it("sandbox success: deposit, upload, publish, confirm DOI, then publish the article with that DOI", async () => {
    const h = harness();
    const r = await runRegistration(h.d, "p1", "w1");
    expect(r).toMatchObject({ outcome: "registered", doi: expect.stringMatching(/^10\.5072\/zenodo\.\d+$/) });
    expect(h.row).toMatchObject({ workflowStatus: "registered", lease: null });
    expect(h.paper).toMatchObject({ status: "PUBLISHED", doi: (r as { doi: string }).doi });
    expect(h.z.calls).toEqual(["POST /api/deposit/depositions", "PUT /api/files/bucket-N/PLY-N-N.pdf", "PUT /api/deposit/depositions/N", "POST /api/deposit/depositions/N/actions/publish", "GET /api/deposit/depositions/N"]);
    expect(h.audits.map((a) => a.action)).toEqual(expect.arrayContaining(["doi_registration_started", "doi_deposit_created", "doi_registered"]));
    expect(JSON.stringify(h.audits)).not.toContain(TOKEN);
    expect([...h.z.tokens]).toEqual([`Bearer ${TOKEN}`]);
  });
  it("duplicate requests never create a second deposit", async () => {
    const h = harness(); await runRegistration(h.d, "p1", "w1");
    expect(await runRegistration(h.d, "p1", "w2")).toMatchObject({ outcome: "skipped" });
    expect(h.z.count("POST /api/deposit/depositions")).toBe(1);
  });
  it("concurrent publish clicks: exactly one worker runs, one deposit, one DOI", async () => {
    const h = harness();
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => runRegistration(h.d, "p1", `w${i}`)));
    expect(rs.filter((r) => r.outcome === "registered")).toHaveLength(1); expect(rs.filter((r) => r.outcome === "skipped")).toHaveLength(7);
    expect(h.z.deps.size).toBe(1); expect(h.registeredCalls).toHaveLength(1);
  });
  it("invalid metadata or missing approval stops before any Zenodo call", async () => {
    for (const input of [{ title: "" }, { approval: { approvedAt: null, approvedBy: null } }, { file: { kind: "other" as const, sizeBytes: 3, sha256Expected: null } }]) {
      const h = harness({ input }); const r = await runRegistration(h.d, "p1", "w1");
      expect(r).toMatchObject({ outcome: "failed", retryable: false }); expect(h.z.calls).toHaveLength(0); expect(h.row.workflowStatus).toBe("failed"); expect(h.paper.doi).toBeNull();
    }
  });
  it("a checksum mismatch is never uploaded", async () => {
    const h = harness({ fileHash: "different" }); expect(await runRegistration(h.d, "p1", "w1")).toMatchObject({ outcome: "failed", code: "FILE_HASH_MISMATCH" });
    expect(h.z.count("PUT /api/files/bucket-N/PLY-N-N.pdf")).toBe(0);
  });
  it("upload failure keeps the deposit, claims no DOI, and a retry resumes the same deposit", async () => {
    const h = harness(); h.z.faults["PUT /api/files/bucket-N/PLY-N-N.pdf"] = ["http500"];
    const r1 = await runRegistration(h.d, "p1", "w1");
    expect(r1).toMatchObject({ outcome: "failed", code: "ZENODO_SERVER_ERROR", retryable: true }); expect(h.row.doi).toBeNull(); expect(h.paper.doi).toBeNull(); expect(h.row.depositId).not.toBeNull();
    h.retry(); const r2 = await runRegistration(h.d, "p1", "w2");
    expect(r2.outcome).toBe("registered"); expect(h.z.count("POST /api/deposit/depositions")).toBe(1);
  });
  it("create timeout: the retry reconciles with Zenodo and adopts the existing deposit instead of creating another", async () => {
    const h = harness(); const orig = h.z.fetch; // the create reaches Zenodo but the response is lost
    let lost = true; h.d.client = new ZenodoClient({ baseUrl: "https://sandbox.zenodo.org/api", token: TOKEN, fetch: async (u, i) => { const r = await orig(u, i); if (lost && i?.method === "POST" && u.endsWith("/depositions")) { lost = false; const e = new Error("aborted"); e.name = "AbortError"; throw e; } return r; } });
    const r1 = await runRegistration(h.d, "p1", "w1");
    expect(r1).toMatchObject({ outcome: "failed", code: "ZENODO_CREATE_UNCERTAIN", retryable: true }); expect(h.z.deps.size).toBe(1); expect(h.row.depositId).toBeNull();
    h.retry(); const r2 = await runRegistration(h.d, "p1", "w2");
    expect(r2.outcome).toBe("registered"); expect(h.z.deps.size).toBe(1); expect(h.z.count("POST /api/deposit/depositions")).toBe(1);
    expect(h.audits.map((a) => a.action)).toContain("doi_deposit_reconciled");
  });
  it("crash after create (lease expiry): the worker that takes over reconciles before creating", async () => {
    const h = harness(); await h.d.client.createDeposit(buildDepositMetadata(good(), h.row.idempotencyKey)); h.row.workflowStatus = "uploading"; // worker died after the create response was lost
    const r = await runRegistration(h.d, "p1", "w2"); expect(r.outcome).toBe("registered"); expect(h.z.deps.size).toBe(1);
  });
  it("publish timeout: verifies the record rather than publishing again; unpublished -> retryable", async () => {
    const h = harness(); h.z.faults["POST /api/deposit/depositions/N/actions/publish"] = ["timeout"];
    const r = await runRegistration(h.d, "p1", "w1"); // publish did not run (fault fires before the server acts)
    expect(r).toMatchObject({ outcome: "failed", code: "ZENODO_PUBLISH_UNCERTAIN", retryable: true }); expect(h.row.doi).toBeNull(); expect(h.paper.doi).toBeNull();
    h.retry(); expect((await runRegistration(h.d, "p1", "w2")).outcome).toBe("registered"); expect(h.z.count("POST /api/deposit/depositions")).toBe(1);
  });
  it("publish that actually succeeded but timed out is adopted, not repeated", async () => {
    const h = harness(); const orig = h.z.fetch; let lost = true;
    h.d.client = new ZenodoClient({ baseUrl: "https://sandbox.zenodo.org/api", token: TOKEN, fetch: async (u, i) => { const r = await orig(u, i); if (lost && u.endsWith("/actions/publish")) { lost = false; const e = new Error("aborted"); e.name = "AbortError"; throw e; } return r; } });
    expect((await runRegistration(h.d, "p1", "w1")).outcome).toBe("registered"); expect(h.z.count("POST /api/deposit/depositions/N/actions/publish")).toBe(1);
  });
  it("rate limits are retried later using Retry-After; retries are bounded", async () => {
    const h = harness(); h.z.faults["POST /api/deposit/depositions"] = ["http429"];
    const r = await runRegistration(h.d, "p1", "w1");
    expect(r).toMatchObject({ outcome: "failed", code: "ZENODO_RATE_LIMITED", retryable: true }); expect(Date.parse(h.row.nextRetryAt!)).toBeGreaterThan(Date.now() + 4000);
    expect(await runRegistration(h.d, "p1", "w2")).toMatchObject({ outcome: "skipped" }); // not due yet
    const g = harness(); g.z.faults["POST /api/deposit/depositions"] = Array(10).fill("http500");
    let last; for (let i = 0; i < 6; i++) { g.row.nextRetryAt = null; last = await runRegistration(g.d, "p1", `w${i}`); }
    expect(last).toMatchObject({ outcome: "failed", retryable: false }); expect(g.row.nextRetryAt).toBe("infinity");
    expect(await runRegistration(g.d, "p1", "wx")).toMatchObject({ outcome: "skipped" });
    g.retry(); g.z.faults["POST /api/deposit/depositions"] = []; expect((await runRegistration(g.d, "p1", "wy", { force: true })).outcome).toBe("registered"); // administrator retry
  });
  it("Zenodo rejecting the metadata is not retried automatically", async () => {
    const h = harness(); h.z.faults["PUT /api/deposit/depositions/N"] = ["http400"];
    expect(await runRegistration(h.d, "p1", "w1")).toMatchObject({ outcome: "failed", code: "ZENODO_METADATA_REJECTED", retryable: false });
    expect(h.paper.doi).toBeNull();
  });
  it("an already published deposit found on retry is verified, never re-created or re-published", async () => {
    const h = harness(); h.z.faults["GET /api/deposit/depositions/N"] = ["http500", null]; // verification read fails once after publishing
    const r1 = await runRegistration(h.d, "p1", "w1"); expect(r1.outcome).toBe("failed"); expect(h.paper.doi).toBeNull();
    h.retry(); expect((await runRegistration(h.d, "p1", "w2")).outcome).toBe("registered");
    expect(h.z.count("POST /api/deposit/depositions")).toBe(1); expect(h.z.count("POST /api/deposit/depositions/N/actions/publish")).toBe(1);
  });
  it("a failure after registration (certificate/publish step) keeps the registration and never recreates it", async () => {
    const h = harness(); h.d.onRegistered = async () => { throw new Error("certificate issuer down"); };
    expect((await runRegistration(h.d, "p1", "w1")).outcome).toBe("registered"); expect(h.row.workflowStatus).toBe("registered");
    expect(h.audits.map((a) => a.action)).toContain("doi_post_registration_failed");
  });
  it("sandbox and production are separated: a production run rejects a sandbox-prefixed DOI", async () => {
    const h = harness({ env: "production" }); const r = await runRegistration(h.d, "p1", "w1");
    expect(r).toMatchObject({ outcome: "registered", doi: expect.stringMatching(/^10\.5281\//) });
    const bad = harness({ env: "production" }); bad.d.client = new ZenodoClient({ baseUrl: "https://zenodo.org/api", token: TOKEN, fetch: async (u, i) => { const x = await bad.z.fetch(u, i); const t = await x.text(); return { ...x, text: async () => t.replace(/10\.5281/g, "10.5072") }; } });
    expect(await runRegistration(bad.d, "p1", "w1")).toMatchObject({ outcome: "failed", code: "DOI_NOT_CONFIRMED" }); expect(bad.paper.doi).toBeNull();
  });
});
