// Phase 8 — version control rules. Pure functions; the database (`commit_new_version` + triggers in
// 0011_version_control.sql) is the authority, this mirror exists for server pre-checks, UI hints and tests. Keep in sync.
import type { PaperStatus } from "./state-machine";

export type VersionKind = "INITIAL" | "REVISION" | "CORRECTION";
export type VersionBump = "MINOR" | "MAJOR";

export interface VersionRef { id: string; major: number; minor: number; file_hash: string; previous_version_id: string | null }

export const MIN_CHANGE_REASON = 10;
export const MAX_CHANGE_REASON = 1000;

/** Statuses in which the author may upload a revised manuscript (it re-enters screening as SUBMITTED). */
export const REVISION_STATUSES: readonly PaperStatus[] = ["REVISION_REQUIRED"];
/** Statuses in which an editor/admin may attach a corrected version to the public record. */
export const CORRECTION_STATUSES: readonly PaperStatus[] = ["PUBLISHED", "CORRECTED"];

export const formatVersion = (v: { major: number; minor: number }) => `${v.major}.${v.minor}`;

export function compareVersions(a: { major: number; minor: number }, b: { major: number; minor: number }): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}

export function latestVersion<T extends { major: number; minor: number }>(versions: readonly T[]): T | null {
  return versions.reduce<T | null>((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
}

/** Next number. MINOR: 1.0 -> 1.1 -> 1.2. MAJOR: 1.2 -> 2.0. Numbers never repeat and never go backwards. */
export function nextVersionNumber(versions: readonly { major: number; minor: number }[], bump: VersionBump): { major: number; minor: number } {
  const last = latestVersion(versions);
  if (!last) return { major: 1, minor: 0 };
  return bump === "MAJOR" ? { major: last.major + 1, minor: 0 } : { major: last.major, minor: last.minor + 1 };
}

export function canSubmitRevision(status: PaperStatus): boolean { return REVISION_STATUSES.includes(status); }
export function canIssueCorrectedVersion(status: PaperStatus): boolean { return CORRECTION_STATUSES.includes(status); }

export interface ChangeInput { kind: VersionKind; status: PaperStatus; changeReason: string; newFileHash: string; currentFileHash: string | null }

/** Returns human-readable violations; empty = allowed. Never throws. */
export function validateVersionChange(i: ChangeInput): string[] {
  const out: string[] = [];
  if (i.kind === "INITIAL") out.push("The first version is created by submission, not by a revision.");
  if (i.kind === "REVISION" && !canSubmitRevision(i.status)) out.push("A revised manuscript can only be uploaded while the editor has requested a revision.");
  if (i.kind === "CORRECTION" && !canIssueCorrectedVersion(i.status)) out.push("A corrected version can only be attached to a published record.");
  const reason = i.changeReason.trim();
  if (reason.length < MIN_CHANGE_REASON) out.push(`Describe what changed (at least ${MIN_CHANGE_REASON} characters).`);
  if (reason.length > MAX_CHANGE_REASON) out.push(`The change description is limited to ${MAX_CHANGE_REASON} characters.`);
  if (i.currentFileHash && i.newFileHash === i.currentFileHash) out.push("This file is identical to the current version. Upload the revised file.");
  return out;
}

/** The chain must be a single line: 1.0 has no predecessor, every later version points at the one before it. */
export function validateChain(versions: readonly VersionRef[]): string[] {
  const out: string[] = [];
  const sorted = [...versions].sort(compareVersions);
  sorted.forEach((v, i) => {
    if (i === 0) { if (v.previous_version_id !== null) out.push(`${formatVersion(v)} must not have a predecessor.`); return; }
    const prev = sorted[i - 1]!;
    if (v.previous_version_id !== prev.id) out.push(`${formatVersion(v)} must point to ${formatVersion(prev)}.`);
  });
  const seen = new Set<string>();
  for (const v of sorted) { const k = formatVersion(v); if (seen.has(k)) out.push(`Duplicate version number ${k}.`); seen.add(k); }
  return out;
}

/** Storage object name for a version; the hash prefix makes a path unguessable-by-number and collision-free per file. */
export function versionStoragePath(ownerId: string, paperId: string, v: { major: number; minor: number }, hash: string, ext = "pdf"): string {
  return `${ownerId}/${paperId}/v${formatVersion(v)}-${hash.slice(0, 12)}.${ext}`;
}

/** Public record label. Retracted records keep their metadata and every version; the label is what changes. */
export function publicStatusLabel(status: PaperStatus): { label: string; tone: "ok" | "notice" | "danger" } | null {
  if (status === "PUBLISHED") return { label: "Published", tone: "ok" };
  if (status === "CORRECTED") return { label: "Corrected", tone: "notice" };
  if (status === "RETRACTED") return { label: "RETRACTED", tone: "danger" };
  return null;
}
