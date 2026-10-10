import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canAssignRole, hasPermission, permissionsFor, rolesGranting } from "./permissions";
import { validateRights, requiresCopyrightReview, type RightsInput } from "./rights-policy";
import { runSubmissionSaga, SubmissionError, type SagaPorts, type UploadFile } from "./submission-saga";
import { parseIdentifier, identifierLabel, looksLikeDoi, ETH_ID_RE } from "./identifiers";
import { NotConfiguredDOIProvider, getDoiProvider } from "./doi-provider";

const good: RightsInput = { is_author: true, coauthor_permission: true, has_upload_rights: true, previously_published: false, manuscript_version_type: "ORIGINAL_SUBMISSION", third_party_content: false, ai_processing_consent: true };

describe("rights policy (G, H, I)", () => {
  it("accepts a complete original submission", () => expect(validateRights(good, { authorCount: 2 })).toEqual([]));
  it("refuses ambiguous upload rights and missing authorship", () => {
    expect(validateRights({ ...good, has_upload_rights: false }, { authorCount: 1 })).not.toEqual([]);
    expect(validateRights({ ...good, is_author: false }, { authorCount: 1 })).not.toEqual([]);
  });
  it("requires co-author agreement only for several authors", () => {
    expect(validateRights({ ...good, coauthor_permission: false }, { authorCount: 1 })).toEqual([]);
    expect(validateRights({ ...good, coauthor_permission: false }, { authorCount: 3 })).not.toEqual([]);
  });
  it("third-party content needs the permission declaration", () => {
    expect(validateRights({ ...good, third_party_content: true }, { authorCount: 1 })).not.toEqual([]);
    expect(validateRights({ ...good, third_party_content: true, third_party_permission: true }, { authorCount: 1 })).toEqual([]);
  });
  it("previously published work needs prior-publication metadata", () => {
    const r = { ...good, previously_published: true, manuscript_version_type: "PREPRINT" as const };
    expect(validateRights(r, { authorCount: 1 })).not.toEqual([]);
    expect(validateRights({ ...r, previous_publication_reference: "Journal X 2024" }, { authorCount: 1 })).toEqual([]);
  });
  it("a publisher version is never silently an original submission", () => {
    expect(validateRights({ ...good, manuscript_version_type: "PUBLISHER_VERSION" }, { authorCount: 1 })).not.toEqual([]);
    const pv = { ...good, manuscript_version_type: "PUBLISHER_VERSION" as const, previously_published: true, previous_doi: "10.1234/abc" };
    expect(validateRights(pv, { authorCount: 1 })).toEqual([]);
    expect(requiresCopyrightReview(pv)).toBe(true);
    expect(validateRights({ ...good, previously_published: true, previous_doi: "10.1/x" }, { authorCount: 1 })).not.toEqual([]);
  });
  it("AI-processing consent must be explicit", () => expect(validateRights({ ...good, ai_processing_consent: false }, { authorCount: 1 })).not.toEqual([]));
});

describe("RBAC / separation of duties (M, N, O, P)", () => {
  it("payment_admin has no editorial, ethics, copyright or publication authority", () => {
    const p = permissionsFor(["payment_admin"]);
    expect([...p]).toEqual(["PAYMENT_MANAGE"]);
  });
  it("editor has no payment or ethics authority", () => {
    expect(hasPermission(["editor"], "PAYMENT_MANAGE")).toBe(false);
    expect(hasPermission(["editor"], "ETHICS_REVIEW")).toBe(false);
  });
  it("only ethics_reviewer holds ETHICS_REVIEW; admins may assign but not decide", () => {
    expect(rolesGranting("ETHICS_REVIEW")).toEqual(["ethics_reviewer"]);
    expect(hasPermission(["admin", "super_admin"], "ETHICS_REVIEW")).toBe(false);
    expect(hasPermission(["admin"], "ETHICS_ASSIGN")).toBe(true);
    expect(hasPermission(["ethics_reviewer"], "EDITORIAL_REVIEW")).toBe(false);
  });
  it("a researcher holds no staff, review, ethics, copyright or payment permission", () => {
    expect([...permissionsFor(["researcher"])]).toEqual(["SUBMISSION_MANAGE"]);
    expect(hasPermission(["researcher"], "AUDIT_READ")).toBe(false);
  });
  it("unknown role names grant nothing", () => expect(permissionsFor(["superuser", ""]).size).toBe(0));
});

// ---------- saga with in-memory ports (C, D, E, F) ----------
function fakePorts(opts: { failUploadAt?: number; failCommit?: string; commitThenThrow?: boolean; removeFails?: boolean } = {}) {
  const storage = new Set<string>(); const quarantined: string[] = []; const failures: string[] = [];
  const attempts = new Map<string, { id: string; paper: string; status: "STARTED" | "COMMITTED" | "FAILED" }>();
  const papers = new Set<string>(); let uploads = 0;
  const ports: SagaPorts = {
    async claim(key) {
      const a = attempts.get(key);
      if (!a) { const n = { id: `att-${key}`, paper: `paper-${key}`, status: "STARTED" as const }; attempts.set(key, n); return { attemptId: n.id, paperId: n.paper, status: "STARTED", owned: true }; }
      if (a.status === "COMMITTED") return { attemptId: a.id, paperId: a.paper, status: "COMMITTED", owned: false };
      if (a.status === "FAILED") { a.status = "STARTED"; return { attemptId: a.id, paperId: a.paper, status: "STARTED", owned: true }; }
      return { attemptId: a.id, paperId: a.paper, status: "STARTED", owned: false };
    },
    async upload(f: UploadFile) { uploads++; if (opts.failUploadAt === uploads) return { error: "storage down" }; storage.add(f.path); return {}; },
    async remove(paths) { if (opts.removeFails) return { error: "delete denied" }; paths.forEach((p) => storage.delete(p)); return {}; },
    async commit(attemptId) {
      const a = [...attempts.values()].find((x) => x.id === attemptId)!;
      if (opts.failCommit && !opts.commitThenThrow) throw new Error(opts.failCommit); // database rolled back: nothing exists
      papers.add(a.paper); a.status = "COMMITTED";
      if (opts.commitThenThrow) throw new Error("connection reset after commit");
      return { paperId: a.paper, replayed: false };
    },
    async attemptStatus(id) { return [...attempts.values()].find((x) => x.id === id)?.status ?? "UNKNOWN"; },
    async fail(id, stage) { failures.push(stage); const a = [...attempts.values()].find((x) => x.id === id); if (a && a.status === "STARTED") a.status = "FAILED"; },
    async quarantine(_a, p) { quarantined.push(p); },
    log() {},
  };
  return { ports, storage, quarantined, failures, papers, attempts };
}
const input = (key = "k-12345678") => ({ idempotencyKey: key, requestHash: "h", correlationId: "c", build: (id: string) => ({ payload: { id }, files: [{ path: `u/${id}/a.pdf`, bytes: new Uint8Array([1]) }, { path: `u/${id}/anon.pdf`, bytes: new Uint8Array([2]) }] }) });

describe("submission saga", () => {
  it("C: success stores every object and commits once", async () => {
    const f = fakePorts(); const r = await runSubmissionSaga(f.ports, input());
    expect(r.replayed).toBe(false); expect(f.papers.size).toBe(1); expect(f.storage.size).toBe(2);
  });
  it("D/E: a failed database commit leaves no paper and removes both uploaded files", async () => {
    const f = fakePorts({ failCommit: "Rights policy: x" });
    await expect(runSubmissionSaga(f.ports, input())).rejects.toBeInstanceOf(SubmissionError);
    expect(f.papers.size).toBe(0); expect(f.storage.size).toBe(0); expect(f.failures).toEqual(["COMMIT"]);
  });
  it("E: a storage failure on the second file removes the first and commits nothing", async () => {
    const f = fakePorts({ failUploadAt: 2 });
    await expect(runSubmissionSaga(f.ports, input())).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    expect(f.papers.size).toBe(0); expect(f.storage.size).toBe(0);
  });
  it("E: when cleanup itself fails the objects are quarantined, never silently orphaned", async () => {
    const f = fakePorts({ failCommit: "boom", removeFails: true });
    await expect(runSubmissionSaga(f.ports, input())).rejects.toBeInstanceOf(SubmissionError);
    expect(f.quarantined.length).toBe(2);
  });
  it("E: an uncertain commit outcome (committed, then connection lost) keeps the files", async () => {
    const f = fakePorts({ commitThenThrow: true });
    const r = await runSubmissionSaga(f.ports, input());
    expect(r.replayed).toBe(true); expect(f.papers.size).toBe(1); expect(f.storage.size).toBe(2);
  });
  it("F: the same key twice yields one paper and one set of files", async () => {
    const f = fakePorts(); const a = await runSubmissionSaga(f.ports, input()); const b = await runSubmissionSaga(f.ports, input());
    expect(b.paperId).toBe(a.paperId); expect(b.replayed).toBe(true); expect(f.papers.size).toBe(1); expect(f.storage.size).toBe(2);
  });
  it("F: a concurrent duplicate is told it is in progress and uploads nothing", async () => {
    const f = fakePorts(); f.attempts.set("k-12345678", { id: "att-k-12345678", paper: "p", status: "STARTED" });
    await expect(runSubmissionSaga(f.ports, input())).rejects.toMatchObject({ code: "IN_PROGRESS" });
    expect(f.storage.size).toBe(0);
  });
  it("a failed attempt can be retried with the same key and then succeeds", async () => {
    const f = fakePorts({ failUploadAt: 1 });
    await expect(runSubmissionSaga(f.ports, input())).rejects.toBeInstanceOf(SubmissionError);
    const ok = await runSubmissionSaga(f.ports, input()); // first upload failed once; the retry owns the same attempt and paper
    expect(ok.paperId).toBe("paper-k-12345678"); expect(f.papers.size).toBe(1); expect(f.storage.size).toBe(2);
  });
});

describe("identifiers and DOI (K, V, W)", () => {
  it("ETH/VER/REV/CERT/PLY parse and are labelled as internal, never as DOIs", () => {
    for (const id of ["PLY-2026-000001", "VER-2026-000012", "ETH-2026-000003", "REV-2026-000004", "CERT-2026-000005"]) {
      expect(parseIdentifier(id)).not.toBeNull(); expect(identifierLabel(id)).toMatch(/not a DOI/); expect(looksLikeDoi(id)).toBe(false);
    }
    expect(ETH_ID_RE.test("ETH-2026-12345")).toBe(false);
    expect(parseIdentifier("10.1234/abc")).toBeNull(); expect(looksLikeDoi("https://doi.org/10.1234/abc")).toBe(true);
  });
  it("V: the DOI provider is still NOT_CONFIGURED and returns no DOI", async () => {
    const p = getDoiProvider(); expect(p).toBeInstanceOf(NotConfiguredDOIProvider);
    const meta = { title: "t", authors: [], publicationDate: "2026-01-01", url: "u", publicId: "PLY-2026-000001", license: null, abstract: "a" };
    expect(await p.register(meta, "k")).toMatchObject({ status: "NOT_CONFIGURED", doi: null });
  });
  it("W: the publication code path never waits on a DOI", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../server/pipeline.server.ts"), "utf8");
    const i = src.indexOf("export async function publishPaper"); const body = src.slice(i, i + 4000);
    expect(body).toMatch(/transition\(paperId, "PUBLISHED"/);
    expect(body).not.toMatch(/doiResult\.status !== "VERIFIED"\)\s*throw/);
  });
});

// ---------- migrations (A, B) and database rules that need a live database to execute (static checks only) ----------
const mdir = path.resolve(__dirname, "../../../drizzle/migrations");
const files = fs.readdirSync(mdir).filter((f) => f.endsWith(".sql")).sort();
const sql = (f: string) => fs.readFileSync(path.join(mdir, f), "utf8");
describe("migration chain (A, B)", () => {
  it("journal lists exactly the files on disk, in order, with increasing timestamps", () => {
    const j = JSON.parse(fs.readFileSync(path.join(mdir, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };
    expect(j.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
    j.entries.forEach((e, i) => { expect(e.idx).toBe(i); if (i) expect(e.when).toBeGreaterThan(j.entries[i - 1]!.when); });
  });
  it("no two migrations have the same body (the 0003/0009 duplicate is neutralised)", () => {
    const seen = new Map<string, string>();
    for (const f of files) { const k = sql(f).replace(/\s+/g, " ").trim(); expect(seen.get(k), `${f} duplicates ${seen.get(k)}`).toBeUndefined(); seen.set(k, f); }
  });
  it("a table is created by exactly one migration unless guarded by IF NOT EXISTS", () => {
    const owner = new Map<string, string>();
    for (const f of files) for (const m of sql(f).matchAll(/create table (?!if not exists)public\.(\w+)/gi)) {
      expect(owner.get(m[1]!), `table ${m[1]} created in ${f} and ${owner.get(m[1]!)}`).toBeUndefined(); owner.set(m[1]!, f);
    }
  });
  it("0009 changes no schema", () => expect(sql("0009_scholarly_identity_orcid_contributors.sql").replace(/^--.*$/gm, "")).not.toMatch(/\b(create|alter|drop)\s+(table|type|index|trigger|policy|function)\b/i));
  it("0010 uses only additive statements", () => expect(sql("0010_trust_integrity_ethics_workflow.sql")).not.toMatch(/\bdrop\s+(table|column|type)\b|\btruncate\b|\bdelete\s+from\b/i));
});

describe("database guarantees present in 0010 (H, U, S, M) - static; execution needs PostgreSQL", () => {
  const s = sql("0010_trust_integrity_ethics_workflow.sql");
  it("rights and ethics declarations reject UPDATE and DELETE", () => {
    expect(s).toMatch(/create trigger rights_declarations_immutable before update or delete/);
    expect(s).toMatch(/create trigger ethics_declarations_immutable before update or delete/);
  });
  it("ethics events are append-only and ETH ids use the existing identifier graph", () => {
    expect(s).toMatch(/ethics_events_append_only before update or delete/);
    expect(s).toMatch(/next_identifier\('ETHICS_CASE'\)/); expect(s).toMatch(/register_identifier\('ETHICS_CASE', 'eth_id'\)/);
    expect(s).not.toMatch(/create or replace function public\.(next_identifier|register_identifier)/);
  });
  it("AI may only escalate to human review inside ethics_transition", () => expect(s).toMatch(/if _to <> 'ETHICS_HUMAN_REVIEW_REQUIRED' then raise exception 'AI cannot take ethics decisions/));
  it("decisions need ethics_reviewer, not the submitter or an author", () => {
    expect(s).toMatch(/has_role\(_actor, 'ethics_reviewer'\)/); expect(s).toMatch(/ethics_actor_is_party\(c\.paper_id, _actor\)/);
  });
  it("browser roles have no direct privileges on the new tables", () => expect(s).toMatch(/revoke all on public\.%I from anon, authenticated/));
  it("publication is blocked unless ethics is cleared or not required", () => expect(s).toMatch(/Publication blocked: ethics status is/));
});

describe("founder role", () => {
  it("sees users and money and allows staff roles, but holds no editorial, settings or audit authority", () => {
    expect([...permissionsFor(["founder"])].sort()).toEqual(["FINANCE_READ", "ROLE_ASSIGN_STAFF", "USERS_READ"]);
    for (const p of ["EDITORIAL_REVIEW", "SYSTEM_ADMIN", "AUDIT_READ", "PAYMENT_MANAGE", "PUBLICATION_MANAGE"] as const) expect(hasPermission(["founder"], p)).toBe(false);
  });
  it("a founder may allow editor and reviewer for others, but never founder and never for themselves", () => {
    expect(canAssignRole(["founder"], "editor", false).ok).toBe(true);
    expect(canAssignRole(["founder"], "reviewer", false).ok).toBe(true);
    expect(canAssignRole(["founder"], "founder", false).ok).toBe(false);
    expect(canAssignRole(["founder"], "editor", true).ok).toBe(false);
  });
  it("only administrators can make a founder; admin-level roles are never assignable", () => {
    expect(canAssignRole(["admin"], "founder", false).ok).toBe(true);
    expect(canAssignRole(["editor", "reviewer"], "reviewer", false).ok).toBe(false);
    expect(canAssignRole(["super_admin"], "admin", false).ok).toBe(false);
  });
});
