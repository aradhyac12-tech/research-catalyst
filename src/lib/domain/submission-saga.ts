// Submission saga. PostgreSQL cannot enclose Supabase Storage in a transaction, so a submission is NOT one transaction.
// What is true instead:
//   - every database row of one submission is written by ONE database function (commit_submission): all or nothing;
//   - storage objects are written BEFORE that function runs, at paths that are unique per paper and named by content hash;
//   - if anything fails, the saga deletes the objects it uploaded (compensation); if a delete fails, the path is recorded in
//     storage_quarantine so it is never silently orphaned;
//   - if the commit call fails in an uncertain way (e.g. the network dropped after the database committed), the attempt row
//     is consulted BEFORE any object is deleted, because deleting the files of a committed paper would be the worse failure;
//   - a client idempotency key makes repeated requests return the same paper instead of creating another.
// This module has no I/O of its own; the ports are supplied by submission.server.ts (and by fakes in the tests).
export interface UploadFile { path: string; bytes: Uint8Array }
export interface ClaimResult { attemptId: string; paperId: string; status: "STARTED" | "COMMITTED" | "FAILED"; owned: boolean }
export interface CommitResult { paperId: string; ethId?: string | undefined; replayed: boolean }

export interface SagaPorts {
  claim(key: string, requestHash: string, correlationId: string): Promise<ClaimResult>;
  upload(file: UploadFile): Promise<{ error?: string }>;
  remove(paths: string[]): Promise<{ error?: string }>;
  commit(attemptId: string, payload: unknown): Promise<CommitResult>;
  attemptStatus(attemptId: string): Promise<"STARTED" | "COMMITTED" | "FAILED" | "UNKNOWN">;
  fail(attemptId: string, stage: string, message: string): Promise<void>;
  quarantine(attemptId: string, path: string, reason: string): Promise<void>;
  log(event: string, fields: Record<string, unknown>): void;
}

export class SubmissionError extends Error {
  readonly code: "IN_PROGRESS" | "UPLOAD_FAILED" | "COMMIT_FAILED" | "REJECTED";
  constructor(message: string, code: "IN_PROGRESS" | "UPLOAD_FAILED" | "COMMIT_FAILED" | "REJECTED") { super(message); this.name = "SubmissionError"; this.code = code; }
}

export interface SagaInput {
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  /** Builds the database payload and the storage objects once the paper id is known (paths contain it). */
  build(paperId: string): { payload: unknown; files: UploadFile[] };
}

export async function runSubmissionSaga(ports: SagaPorts, input: SagaInput): Promise<CommitResult> {
  const claim = await ports.claim(input.idempotencyKey, input.requestHash, input.correlationId);
  if (claim.status === "COMMITTED") return { paperId: claim.paperId, replayed: true };
  if (!claim.owned) throw new SubmissionError("This submission is already being processed. Wait a moment and check My research.", "IN_PROGRESS");

  const { payload, files } = input.build(claim.paperId);
  const uploaded: string[] = [];

  const compensate = async (stage: string): Promise<void> => {
    if (uploaded.length === 0) return;
    const res = await ports.remove(uploaded).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "remove failed" }));
    if (res.error) {
      // Could not delete: keep a durable record instead of leaving an unexplained orphan.
      for (const p of uploaded) await ports.quarantine(claim.attemptId, p, `${stage}: cleanup failed (${res.error})`).catch(() => ports.log("storage_orphan_unrecorded", { path: p, attempt: claim.attemptId }));
      ports.log("storage_compensation_failed", { attempt: claim.attemptId, count: uploaded.length });
    }
  };

  for (const f of files) {
    const r = await ports.upload(f).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "upload threw" }));
    if (r.error) {
      await compensate("UPLOAD");
      await ports.fail(claim.attemptId, "UPLOAD", r.error).catch(() => undefined);
      throw new SubmissionError("The file could not be stored. Nothing was submitted; please try again.", "UPLOAD_FAILED");
    }
    uploaded.push(f.path);
  }

  try {
    const done = await ports.commit(claim.attemptId, payload);
    return done;
  } catch (e) {
    const message = e instanceof Error ? e.message : "commit failed";
    // Uncertain outcome: only delete files if the database says the submission did NOT commit.
    const status = await ports.attemptStatus(claim.attemptId).catch(() => "UNKNOWN" as const);
    if (status === "COMMITTED") return { paperId: claim.paperId, replayed: true };
    if (status === "UNKNOWN") {
      // Cannot tell. Do not delete: the paper might exist. Record for a person; a retry with the same key is safe.
      for (const p of uploaded) await ports.quarantine(claim.attemptId, p, "COMMIT outcome unknown").catch(() => undefined);
      ports.log("submission_outcome_unknown", { attempt: claim.attemptId });
      throw new SubmissionError("We could not confirm your submission. Check My research before trying again; retrying is safe.", "COMMIT_FAILED");
    }
    await compensate("COMMIT");
    await ports.fail(claim.attemptId, "COMMIT", message).catch(() => undefined);
    throw new SubmissionError(`Could not save the submission: ${userSafeCommitMessage(message)}`, "COMMIT_FAILED");
  }
}

/** Database policy errors ("Rights policy: ...") are written for authors; anything else is replaced by a generic text. */
export function userSafeCommitMessage(message: string): string {
  const m = /^(Rights policy: .+)$/m.exec(message);
  return m?.[1] ?? "please try again. Nothing was stored.";
}

export async function canonicalJson(v: unknown): Promise<string> {
  const walk = (x: unknown): unknown => Array.isArray(x) ? x.map(walk) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, walk((x as Record<string, unknown>)[k])])) : x;
  return JSON.stringify(walk(v));
}
