import { db, dbx, audit, notify, requireRole, getRoles, STAFF, ADMINS, log } from "./core.server";
import { scanManuscript, manuscriptKind, kindMime, sha256Hex, MAX_UPLOAD_BYTES, type FileScanResult } from "@/lib/domain/file-security";
import { canIssueCorrectedVersion, canSubmitRevision, formatVersion, nextVersionNumber, validateVersionChange, versionStoragePath, type VersionBump, type VersionKind } from "@/lib/domain/versioning";
import type { PaperStatus } from "@/lib/domain/state-machine";

const BUCKET = "manuscripts";

export interface PreparedPdf { bytes: Uint8Array; hash: string; scan: FileScanResult; ext: "pdf" | "docx" }

export async function preparePdf(f: File, label = "File"): Promise<PreparedPdf> {
  if (f.size > MAX_UPLOAD_BYTES) throw new Error(`${label} is larger than 25 MB`);
  const bytes = new Uint8Array(await f.arrayBuffer());
  const scan = scanManuscript(bytes, f.name, f.type);
  if (!scan.passed) throw new Error(`${label} rejected: ${scan.reasons.join("; ")}`);
  return { bytes, hash: await sha256Hex(bytes), scan, ext: manuscriptKind(f.name) ?? "pdf" };
}

/** Database exceptions that carry a message meant for the person; everything else becomes a generic failure. */
const FRIENDLY = /(revision can only|corrected version can only|Only the submitting author|Only an administrator|Conflict of interest|identical to the current version|needs a description|response to the reviewers|public notice|No new version can be added|Version numbers advance|must follow the latest)/i;
function friendly(message: string): Error {
  return new Error(FRIENDLY.test(message) ? message : "Could not record the new version. Nothing was changed. Please try again.");
}

export interface VersionRow {
  id: string; version: string; kind: VersionKind; uploaded_at: string; change_reason: string | null; file_hash: string; file_size: number;
  previous_version: string | null; is_current: boolean; has_anonymized: boolean; correction_notice: string | null;
}

/** Version history for the submitting author and for staff. File locations are never returned. */
export async function listVersions(paperId: string, uid: string): Promise<VersionRow[]> {
  const { data: paper } = await db.from("papers").select("id, owner_id, current_version_id").eq("id", paperId).single();
  if (!paper) throw new Error("Not found");
  if (paper.owner_id !== uid) {
    const roles = await getRoles(uid);
    if (!roles.some((r) => STAFF.includes(r))) throw new Error("Not found");
  }
  const { data: rows } = await dbx.from("paper_versions")
    .select("id, major, minor, version_kind, uploaded_at, change_reason, file_hash, file_size, previous_version_id, anonymized_file_hash").eq("paper_id", paperId).order("major").order("minor");
  const { data: notices } = await dbx.from("corrections").select("new_version_id, notice").eq("paper_id", paperId).not("new_version_id", "is", null);
  const byId = new Map<string, { major: number; minor: number }>((rows ?? []).map((r: { id: string; major: number; minor: number }) => [r.id, r]));
  const noticeFor = new Map<string, string>((notices ?? []).map((n: { new_version_id: string; notice: string }) => [n.new_version_id, n.notice]));
  return (rows ?? []).map((r: Record<string, unknown>) => {
    const prev = r["previous_version_id"] ? byId.get(r["previous_version_id"] as string) : undefined;
    return {
      id: r["id"] as string, version: `${r["major"]}.${r["minor"]}`, kind: r["version_kind"] as VersionKind, uploaded_at: r["uploaded_at"] as string,
      change_reason: (r["change_reason"] as string | null) ?? null, file_hash: r["file_hash"] as string, file_size: Number(r["file_size"]),
      previous_version: prev ? formatVersion(prev) : null, is_current: r["id"] === paper.current_version_id, has_anonymized: Boolean(r["anonymized_file_hash"]),
      correction_notice: noticeFor.get(r["id"] as string) ?? null,
    };
  });
}

/** True when some committed version row points at this storage object (so it must never be deleted by a compensation). */
async function isReferenced(path: string): Promise<boolean> {
  const a = await dbx.from("paper_versions").select("id", { count: "exact", head: true }).eq("storage_path", path);
  const b = await dbx.from("paper_versions").select("id", { count: "exact", head: true }).eq("anonymized_storage_path", path);
  // If we cannot tell, treat it as referenced: leaving an orphan is recoverable, deleting a manuscript is not.
  if (a.error || b.error) return true;
  return (a.count ?? 0) > 0 || (b.count ?? 0) > 0;
}

interface CommitArgs {
  kind: Exclude<VersionKind, "INITIAL">; paperId: string; actorId: string; bump: VersionBump; changeReason: string;
  file: PreparedPdf; anon?: PreparedPdf | null; authorName: string; payload: Record<string, unknown>;
}

/** Upload (saga step 1) -> one database transaction (step 2) -> compensate on failure (step 3). Storage is NOT inside the transaction. */
async function commitVersion(a: CommitArgs): Promise<{ version: string; versionId: string }> {
  const { data: paper } = await db.from("papers").select("id, status, owner_id, current_version_id").eq("id", a.paperId).single();
  if (!paper) throw new Error("Not found");
  const { data: cur } = await dbx.from("paper_versions").select("file_hash").eq("id", paper.current_version_id).maybeSingle();
  const violations = validateVersionChange({ kind: a.kind, status: paper.status as PaperStatus, changeReason: a.changeReason, newFileHash: a.file.hash, currentFileHash: (cur?.file_hash as string | undefined) ?? null });
  if (violations.length) throw new Error(violations.join(" "));

  const { data: all } = await dbx.from("paper_versions").select("major, minor").eq("paper_id", a.paperId);
  const next = nextVersionNumber(all ?? [], a.bump);
  const path = versionStoragePath(paper.owner_id, a.paperId, next, a.file.hash, a.file.ext);
  const anonPath = a.anon ? path.replace(/\.(pdf|docx)$/, `-anon-${a.anon.hash.slice(0, 12)}.${a.anon.ext}`) : null;

  const created: string[] = [];
  const put = async (p: string, bytes: Uint8Array) => {
    const r = await db.storage.from(BUCKET).upload(p, bytes, { contentType: kindMime(p.endsWith(".docx") ? "docx" : "pdf"), upsert: false });
    if (!r.error) { created.push(p); return; }
    // The object name contains the file hash, so "already exists" means the same bytes (e.g. a double click). It is not ours to delete.
    if (!/exists|duplicate/i.test(r.error.message)) throw new Error("Upload failed. Please try again.");
  };
  await put(path, a.file.bytes);
  if (a.anon && anonPath) await put(anonPath, a.anon.bytes).catch(async (e) => { await compensate(created, a.actorId, a.paperId, "anonymized_upload_failed"); throw e; });

  const { data, error } = await dbx.rpc("commit_new_version", {
    _paper: a.paperId, _actor: a.actorId, _kind: a.kind, _bump: a.bump,
    _p: { ...a.payload, change_reason: a.changeReason.trim(), version: { storage_path: path, file_hash: a.file.hash, file_size: a.file.bytes.length, author_name: a.authorName, scan_result: a.file.scan, anonymized_storage_path: anonPath, anonymized_file_hash: a.anon?.hash ?? null } },
  });
  if (error) {
    await compensate(created, a.actorId, a.paperId, "commit_failed");
    throw friendly(error.message);
  }
  const r = data as { version_id: string; version: string };
  return { version: r.version, versionId: r.version_id };
}

async function compensate(paths: string[], actor: string, paperId: string, stage: string) {
  const doomed: string[] = [];
  for (const p of paths) if (!(await isReferenced(p))) doomed.push(p);
  if (!doomed.length) return;
  const r = await db.storage.from(BUCKET).remove(doomed);
  if (r.error) {
    // Cannot be fixed here. The audit row is the evidence an operator needs to clean up; the object is unreachable from any record.
    log("version_storage_orphan", { paper_id: paperId, stage, count: doomed.length });
    await audit({ actor_id: actor, actor_type: "SYSTEM", action: "version_storage_orphan", resource_type: "paper", resource_id: paperId, metadata: { stage, paths: doomed, error: r.error.message } });
  }
}

/** Author uploads a revised manuscript after the editor asked for a revision. */
export async function submitRevisionVersion(uid: string, args: { paperId: string; file: PreparedPdf; anon: PreparedPdf | null; bump: VersionBump; summary: string; response: string }) {
  const { data: paper } = await db.from("papers").select("id, owner_id, status").eq("id", args.paperId).single();
  if (!paper || paper.owner_id !== uid) throw new Error("Not found");
  if (!canSubmitRevision(paper.status as PaperStatus)) throw new Error("A revision was not requested for this paper");
  const { data: prof } = await db.from("profiles").select("display_name").eq("id", uid).single();
  return commitVersion({ kind: "REVISION", paperId: args.paperId, actorId: uid, bump: args.bump, changeReason: args.summary, file: args.file, anon: args.anon, authorName: prof?.display_name ?? "Unknown", payload: { response_text: args.response } });
}

/** Administrator attaches a corrected manuscript to a published record. The earlier version, its hash and its certificates stay as issued. */
export async function issueCorrectedVersion(uid: string, args: { paperId: string; file: File; notice: string; reason: string; newTitle?: string | undefined; newAbstract?: string | undefined }) {
  await requireRole(uid, ADMINS);
  const { data: paper } = await db.from("papers").select("id, owner_id, status, paperly_id, title, current_version_id").eq("id", args.paperId).single();
  if (!paper) throw new Error("Not found");
  if (paper.owner_id === uid) throw new Error("Conflict of interest: you cannot correct a record you submitted");
  if (!canIssueCorrectedVersion(paper.status as PaperStatus)) throw new Error("A corrected version can only be attached to a published record");
  const { data: curVer } = await dbx.from("paper_versions").select("author_name_at_submission").eq("id", paper.current_version_id).single();
  const file = await preparePdf(args.file, "The corrected manuscript");
  const out = await commitVersion({
    kind: "CORRECTION", paperId: args.paperId, actorId: uid, bump: "MINOR", changeReason: args.reason, file, authorName: curVer?.author_name_at_submission ?? "Unknown",
    payload: { notice: args.notice, title: args.newTitle ?? null, abstract: args.newAbstract ?? null },
  });
  await audit({ actor_id: uid, action: "corrected_version_issued", resource_type: "paper", resource_id: args.paperId, new_value: { version: out.version }, metadata: { file_hash: file.hash } });
  await notify(paper.owner_id, "notice", "A corrected version was published", `${paper.paperly_id}: version ${out.version} replaces the current version. Earlier versions remain listed.`, `/article/${paper.paperly_id}`);
  return { version: out.version };
}
