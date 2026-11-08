// Zenodo registration orchestration over injected ports (database store, Zenodo client, file/metadata loaders, audit).
// Rules enforced here: one active worker per paper (lease claim), never a second deposit after a recorded id or an uncertain create,
// reconcile before retrying, bounded retries, DOI accepted only after Zenodo confirms the published record.
import { ZenodoError, type ZenodoClient, type ZenodoDeposition } from "./zenodo-client";
import {
  buildDepositMetadata, idempotencyMarker, nextRetryDelayMs, retriesExhausted, validateConfirmedDoi, validateForDeposit, redactSecret,
  type ZenodoEnvironment, type ZenodoPaperInput, type ZenodoWorkflowStatus,
} from "./zenodo";

export interface RegistrationRecord {
  paperId: string; workflowStatus: ZenodoWorkflowStatus; environment: ZenodoEnvironment; idempotencyKey: string;
  depositId: number | null; recordId: number | null; doi: string | null; doiUrl: string | null; recordUrl: string | null;
  fileUploaded: boolean; attemptCount: number; lastErrorCode: string | null;
}
export type RecordPatch = Partial<{
  workflowStatus: ZenodoWorkflowStatus; depositId: number; recordId: number; doi: string; doiUrl: string; recordUrl: string; fileSha256: string; uploadedAt: string;
  lastError: string | null; lastErrorCode: string | null; nextRetryAt: string | null; releaseLease: boolean; verified: boolean;
}>;
export interface WorkflowDeps {
  client: ZenodoClient; environment: ZenodoEnvironment; token: string;
  claim(paperId: string, owner: string, force: boolean): Promise<RegistrationRecord | null>;
  save(paperId: string, patch: RecordPatch): Promise<void>;
  loadInput(paperId: string): Promise<ZenodoPaperInput>;
  /** `sha256` is the checksum of the bytes deposited. When those were converted from the stored file (Word to PDF), `sourceSha256` is the stored file's checksum. */
  loadFile(paperId: string): Promise<{ bytes: Uint8Array; filename: string; sha256: string; sourceSha256?: string }>;
  audit(action: string, paperId: string, metadata: Record<string, unknown>): Promise<void>;
  /** Called once, only after the DOI is registered and verified: store it on the paper and publish/issue certificates. May fail without undoing the registration. */
  onRegistered(paperId: string, r: { doi: string; doiUrl: string; recordUrl: string }): Promise<void>;
  now?: () => number; jitter?: () => number;
}
export type Outcome =
  | { outcome: "skipped"; reason: "not_claimable" }
  | { outcome: "registered"; doi: string; doiUrl: string; recordUrl: string }
  | { outcome: "failed"; code: string; message: string; retryable: boolean; nextRetryAt: string | null };

const PERMANENT = "infinity";
const CREATE_UNCERTAIN = "ZENODO_CREATE_UNCERTAIN";
const PUBLISH_UNCERTAIN = "ZENODO_PUBLISH_UNCERTAIN";

export async function runRegistration(d: WorkflowDeps, paperId: string, owner: string, opts: { force?: boolean } = {}): Promise<Outcome> {
  const rec = await d.claim(paperId, owner, !!opts.force);
  if (!rec) return { outcome: "skipped", reason: "not_claimable" };
  const now = d.now ?? Date.now;
  let depositId = rec.depositId;
  let step = "claim";
  const fail = async (code: string, message: string, retryable: boolean, retryAfterMs: number | null = null): Promise<Outcome> => {
    const exhausted = retriesExhausted(rec.attemptCount);
    const canRetry = retryable && !exhausted;
    const next = canRetry ? new Date(now() + nextRetryDelayMs(rec.attemptCount, retryAfterMs, (d.jitter ?? (() => 0.5))())).toISOString() : PERMANENT;
    const msg = redactSecret(message, d.token).slice(0, 500);
    await d.save(paperId, { workflowStatus: "failed", lastError: msg, lastErrorCode: code, nextRetryAt: next, releaseLease: true });
    await d.audit("doi_registration_failed", paperId, { code, step, retryable: canRetry, attempt: rec.attemptCount, deposit_id: depositId, environment: d.environment });
    return { outcome: "failed", code, message: msg, retryable: canRetry, nextRetryAt: canRetry ? next : null };
  };

  try {
    // 1. validate everything before any Zenodo call
    step = "validate";
    const input = await d.loadInput(paperId);
    const issues = validateForDeposit(input);
    if (issues.length) return await fail(`VALIDATION_${issues[0]?.code ?? "UNKNOWN"}`, issues.map((i) => i.message).join("; "), false);
    const meta = buildDepositMetadata(input, rec.idempotencyKey);
    await d.audit("doi_registration_started", paperId, { attempt: rec.attemptCount, environment: d.environment, deposit_id: depositId });

    // 2. a recorded deposit is only ever resumed. A published one is verified, never re-created.
    let dep: ZenodoDeposition | null = null;
    if (depositId != null) {
      step = "reconcile_existing";
      dep = await d.client.getDeposit(depositId);
      if (dep.submitted === true && dep.state === "done") return await finish(dep);
    } else {
      // Uncertain create (timeout, crash between request and response): search for our own marker before creating anything.
      const uncertain = rec.workflowStatus === "uploading" || rec.lastErrorCode === CREATE_UNCERTAIN;
      if (uncertain) {
        step = "reconcile_create";
        const found = await d.client.findByMarker(idempotencyMarker(rec.idempotencyKey));
        if (found) { dep = found; depositId = found.id; await d.save(paperId, { depositId: found.id }); await d.audit("doi_deposit_reconciled", paperId, { deposit_id: found.id }); }
      }
      if (!dep) {
        step = "create_deposit";
        await d.save(paperId, { workflowStatus: "uploading", lastError: null, lastErrorCode: null });
        try { dep = await d.client.createDeposit(meta); } catch (e) {
          if (e instanceof ZenodoError && (e.info.kind === "timeout" || e.info.kind === "network")) { await d.save(paperId, { lastErrorCode: CREATE_UNCERTAIN }); return await fail(CREATE_UNCERTAIN, e.info.message, true); }
          throw e;
        }
        depositId = dep.id; await d.save(paperId, { depositId: dep.id });
        await d.audit("doi_deposit_created", paperId, { deposit_id: dep.id, environment: d.environment });
      }
    }
    if (depositId == null || !dep) return await fail("ZENODO_NO_DEPOSIT", "No deposit could be established", false);

    // 3. file upload (skipped if Zenodo already holds the same file for this draft)
    step = "upload_file";
    await d.save(paperId, { workflowStatus: "uploading" });
    const file = await d.loadFile(paperId);
    if (input.file?.sha256Expected && (file.sourceSha256 ?? file.sha256) !== input.file.sha256Expected) return await fail("FILE_HASH_MISMATCH", "The stored manuscript does not match its recorded checksum; it was not uploaded", false);
    const already = (dep.files ?? []).some((f) => f.filename === file.filename && f.filesize === file.bytes.byteLength);
    if (!already) {
      const bucket = dep.links?.bucket;
      if (!bucket) return await fail("ZENODO_NO_BUCKET", "Zenodo returned no upload address for the deposit", false);
      await d.client.uploadFile(bucket, file.filename, file.bytes);
    }
    await d.save(paperId, { fileSha256: file.sha256, uploadedAt: new Date(now()).toISOString() });
    step = "update_metadata";
    await d.client.updateMetadata(depositId, meta);

    // 4. publish, then re-read and validate. An uncertain publish is verified, never repeated.
    step = "publish";
    await d.save(paperId, { workflowStatus: "publishing" });
    try { await d.client.publish(depositId); } catch (e) {
      if (e instanceof ZenodoError && (e.info.kind === "timeout" || e.info.kind === "network")) {
        const check = await d.client.getDeposit(depositId).catch(() => null);
        if (!(check?.submitted === true && check.state === "done")) { await d.save(paperId, { lastErrorCode: PUBLISH_UNCERTAIN }); return await fail(PUBLISH_UNCERTAIN, e.info.message, true); }
      } else throw e;
    }
    step = "verify";
    return await finish(await d.client.getDeposit(depositId));
  } catch (e) {
    if (e instanceof ZenodoError) return await fail(e.info.code, e.info.message, e.info.retryable, e.info.retryAfterMs);
    return await fail("UNEXPECTED_ERROR", e instanceof Error ? e.message : "Unexpected error", false);
  }

  async function finish(dep: ZenodoDeposition): Promise<Outcome> {
    const c = validateConfirmedDoi(dep, d.environment, depositId);
    if (!c.ok) return await fail(c.code, c.message, true);
    await d.save(paperId, { workflowStatus: "registered", depositId: c.recordId, recordId: c.recordId, doi: c.doi, doiUrl: c.doiUrl, recordUrl: c.recordUrl, verified: true, lastError: null, lastErrorCode: null, nextRetryAt: null, releaseLease: true });
    await d.audit("doi_registered", paperId, { doi: c.doi, record_id: c.recordId, record_url: c.recordUrl, environment: d.environment });
    try { await d.onRegistered(paperId, { doi: c.doi, doiUrl: c.doiUrl, recordUrl: c.recordUrl }); }
    catch (e) { await d.audit("doi_post_registration_failed", paperId, { error: redactSecret(e instanceof Error ? e.message : "unknown", d.token).slice(0, 300) }); }
    return { outcome: "registered", doi: c.doi, doiUrl: c.doiUrl, recordUrl: c.recordUrl };
  }
}
