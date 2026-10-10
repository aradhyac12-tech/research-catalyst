import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canIssueCorrectedVersion, canSubmitRevision, compareVersions, formatVersion, latestVersion, nextVersionNumber, publicStatusLabel, validateChain, validateVersionChange, versionStoragePath, type VersionRef } from "./versioning";
import { nextVersion } from "./review";

const H1 = "a".repeat(64), H2 = "b".repeat(64);
const ok = { kind: "REVISION" as const, status: "REVISION_REQUIRED" as const, changeReason: "Added the missing control group analysis", newFileHash: H2, currentFileHash: H1 };

describe("version numbering", () => {
  it("starts at 1.0 and steps minor or major without ever repeating", () => {
    expect(nextVersionNumber([], "MINOR")).toEqual({ major: 1, minor: 0 });
    expect(nextVersionNumber([{ major: 1, minor: 0 }], "MINOR")).toEqual({ major: 1, minor: 1 });
    expect(nextVersionNumber([{ major: 1, minor: 0 }, { major: 1, minor: 1 }], "MAJOR")).toEqual({ major: 2, minor: 0 });
    expect(nextVersionNumber([{ major: 2, minor: 0 }, { major: 1, minor: 4 }], "MINOR")).toEqual({ major: 2, minor: 1 });
  });
  it("matches the existing editorial helper used by peer review", () => {
    for (const bump of ["MINOR", "MAJOR"] as const) expect(nextVersionNumber([{ major: 1, minor: 2 }], bump)).toEqual(nextVersion({ major: 1, minor: 2 }, bump));
  });
  it("orders 1.9 before 1.10 and 1.10 before 2.0 (numeric, not text)", () => {
    expect(compareVersions({ major: 1, minor: 9 }, { major: 1, minor: 10 })).toBeLessThan(0);
    expect(latestVersion([{ major: 1, minor: 10 }, { major: 2, minor: 0 }, { major: 1, minor: 9 }])).toEqual({ major: 2, minor: 0 });
    expect(formatVersion({ major: 1, minor: 10 })).toBe("1.10");
  });
});

describe("who may add a version, and when", () => {
  it("revisions only while a revision is requested", () => {
    expect(canSubmitRevision("REVISION_REQUIRED")).toBe(true);
    for (const s of ["SUBMITTED", "PEER_REVIEW", "ACCEPTED", "PUBLISHED", "RETRACTED", "REJECTED", "WITHDRAWN", "ARCHIVED"] as const) expect(canSubmitRevision(s)).toBe(false);
  });
  it("corrected files only on published or corrected records, never retracted ones", () => {
    expect(canIssueCorrectedVersion("PUBLISHED")).toBe(true);
    expect(canIssueCorrectedVersion("CORRECTED")).toBe(true);
    for (const s of ["RETRACTED", "ARCHIVED", "REVISION_REQUIRED", "SUBMITTED"] as const) expect(canIssueCorrectedVersion(s)).toBe(false);
  });
  it("accepts a valid revision", () => expect(validateVersionChange(ok)).toEqual([]));
  it("refuses a missing or too short reason", () => {
    expect(validateVersionChange({ ...ok, changeReason: "" })).not.toEqual([]);
    expect(validateVersionChange({ ...ok, changeReason: "fixed" })).not.toEqual([]);
    expect(validateVersionChange({ ...ok, changeReason: "x".repeat(1001) })).not.toEqual([]);
  });
  it("refuses re-uploading the identical file", () => expect(validateVersionChange({ ...ok, newFileHash: H1 })).not.toEqual([]));
  it("refuses the wrong state and the initial kind", () => {
    expect(validateVersionChange({ ...ok, status: "PUBLISHED" })).not.toEqual([]);
    expect(validateVersionChange({ ...ok, kind: "INITIAL" })).not.toEqual([]);
    expect(validateVersionChange({ ...ok, kind: "CORRECTION", status: "RETRACTED" })).not.toEqual([]);
  });
});

describe("version chain integrity", () => {
  const v = (id: string, major: number, minor: number, prev: string | null): VersionRef => ({ id, major, minor, file_hash: id, previous_version_id: prev });
  it("accepts a single line", () => expect(validateChain([v("a", 1, 0, null), v("b", 1, 1, "a"), v("c", 2, 0, "b")])).toEqual([]));
  it("rejects a predecessor on 1.0, a skipped link and duplicates", () => {
    expect(validateChain([v("a", 1, 0, "x")])).not.toEqual([]);
    expect(validateChain([v("a", 1, 0, null), v("b", 1, 1, null)])).not.toEqual([]);
    expect(validateChain([v("a", 1, 0, null), v("b", 1, 0, "a")])).not.toEqual([]);
  });
  it("storage names carry number and hash prefix, so a new version never overwrites an old object", () => {
    const p1 = versionStoragePath("u", "p", { major: 1, minor: 0 }, H1), p2 = versionStoragePath("u", "p", { major: 1, minor: 1 }, H2);
    expect(p1).not.toBe(p2);
    expect(p2).toBe(`u/p/v1.1-${H2.slice(0, 12)}.pdf`);
  });
});

describe("public record status", () => {
  it("marks retraction clearly and keeps published/corrected distinct", () => {
    expect(publicStatusLabel("RETRACTED")).toEqual({ label: "RETRACTED", tone: "danger" });
    expect(publicStatusLabel("CORRECTED")?.tone).toBe("notice");
    expect(publicStatusLabel("PUBLISHED")?.tone).toBe("ok");
    expect(publicStatusLabel("SUBMITTED")).toBeNull();
  });
});

// Static checks on the migration and server wiring (the SQL itself is NOT executed here; see supabase_tests/0011_version_control.sql).
describe("0011_version_control.sql and wiring (static)", () => {
  const root = process.cwd();
  const sql = fs.readFileSync(path.join(root, "drizzle/migrations/0011_version_control.sql"), "utf8");
  const srv = fs.readFileSync(path.join(root, "src/lib/server/versions.server.ts"), "utf8");
  const review = fs.readFileSync(path.join(root, "src/lib/server/review.server.ts"), "utf8");
  const journal = fs.readFileSync(path.join(root, "drizzle/migrations/meta/_journal.json"), "utf8");
  it("is registered in the journal", () => expect(journal).toContain("0011_version_control"));
  it("guards the chain, freezes chain columns and never deletes versions", () => {
    expect(sql).toContain("create trigger paper_versions_chain before insert");
    expect(sql).toContain("previous_version_id is distinct from old.previous_version_id");
    expect(sql).toContain("Manuscript versions cannot be deleted");
    expect(sql).toMatch(/No new version can be added to a record that is/);
    expect(sql).not.toMatch(/delete\s+from\s+public\.paper_versions/i);
  });
  it("anonymized copies stay updatable (review.server.ts addAnonymizedCopy relies on it)", () => {
    const fn = sql.slice(sql.indexOf("function public.versions_immutable"), sql.indexOf("function public.guard_version_chain"));
    expect(fn).not.toContain("anonymized_");
  });
  it("commit_new_version is service-role only and enforces role, owner and state", () => {
    expect(sql).toContain("revoke all on function public.commit_new_version(uuid, uuid, text, text, jsonb) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.commit_new_version(uuid, uuid, text, text, jsonb) to service_role");
    expect(sql).toContain("Only the submitting author can upload a revision");
    expect(sql).toContain("Only an administrator can issue a corrected version");
    expect(sql).toContain("Conflict of interest");
  });
  it("a correction goes through the existing correction path and links the new version", () => {
    expect(sql).toContain("public.apply_published_correction(");
    expect(sql).toMatch(/insert into public\.corrections\(paper_id, kind, notice, reason, new_version_id, issued_by\)/);
  });
  it("the revision flow no longer performs separate writes in review.server.ts", () => {
    const fn = review.slice(review.indexOf("export async function resubmitRevision"), review.indexOf("export async function withdrawPaper"));
    expect(fn).not.toContain('from("paper_versions").insert');
    expect(fn).not.toContain('from("papers").update');
    expect(fn).toContain("submitRevisionVersion");
  });
  it("storage compensation never deletes an object a committed version references", () => {
    expect(srv).toContain("isReferenced");
    expect(srv).toMatch(/upsert: false/);
  });
});
