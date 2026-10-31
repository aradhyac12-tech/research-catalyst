// Admin control over each author's certificate. An administrator can put one author's certificate on hold (for example when that person
// looks suspicious) without affecting the other authors of the same paper. While on hold the author gets no certificate and no certificate
// e-mail, and a certificate that already exists is hidden (Certificates list, download, public verification) until the hold is lifted.
// The reason is internal: it is kept in the audit log and in a table that clients cannot read, and the author is not notified.
import { db, dbx, audit, requireRole, ADMINS, log } from "./core.server";

interface HoldRow { author_id: string; reason: string; paused_at: string; paused_by: string }

/** Every listed author of a paper with their certificate state. Administrators only. */
export async function listPaperAuthorCertificates(uid: string, paperId: string) {
  await requireRole(uid, ADMINS);
  const { data: paper } = await db.from("papers").select("id, public_id, owner_id, status, title, doi").eq("id", paperId).maybeSingle();
  if (!paper) throw new Error("Paper not found");
  const { data: authors } = await db.from("paper_authors").select("id, full_name, email, user_id, position").eq("paper_id", paperId).order("position");
  const { data: holds } = await dbx.from("author_certificate_holds").select("author_id, reason, paused_at, paused_by").eq("paper_id", paperId);
  const holdMap = new Map(((holds ?? []) as HoldRow[]).map((h) => [h.author_id, h]));
  const { data: certs } = await db.from("certificates").select("certificate_id, certificate_type, recipient_author_id, recipient_user_id, status").eq("paper_id", paperId);
  const published = ["PUBLISHED", "CORRECTED"].includes(paper.status);
  return {
    published, title: paper.title as string, hasDoi: !!paper.doi,
    authors: (authors ?? []).map((a) => {
      const mine = (certs ?? []).filter((c) => c.recipient_author_id === a.id || (!c.recipient_author_id && !!a.user_id && c.recipient_user_id === a.user_id));
      const h = holdMap.get(a.id);
      return {
        id: a.id, position: a.position, fullName: a.full_name, email: a.email, isUploader: a.user_id === paper.owner_id,
        onHold: !!h, holdReason: h?.reason ?? null, heldAt: h?.paused_at ?? null,
        certificates: mine.map((c) => ({ certificateId: c.certificate_id, type: c.certificate_type, status: c.status })),
      };
    }),
  };
}

async function loadAuthor(authorId: string) {
  const { data: a } = await db.from("paper_authors").select("id, paper_id, full_name, user_id").eq("id", authorId).maybeSingle();
  if (!a) throw new Error("Author not found");
  const { data: p } = await db.from("papers").select("id, public_id, deleted_at").eq("id", a.paper_id).maybeSingle();
  if (!p || p.deleted_at) throw new Error("Paper not found");
  return { a, p };
}

/** Marks every certificate that belongs to this author entry (linked directly, or the uploader's own) as on hold / released. */
async function setCertificatesOnHold(a: { id: string; paper_id: string; user_id: string | null }, onHold: boolean, uid: string, reason: string) {
  const { data: certs } = await db.from("certificates").select("id, certificate_id, recipient_author_id, recipient_user_id").eq("paper_id", a.paper_id);
  const mine = (certs ?? []).filter((c) => c.recipient_author_id === a.id || (!c.recipient_author_id && !!a.user_id && c.recipient_user_id === a.user_id));
  for (const c of mine) {
    const { error } = await dbx.from("certificates").update({ on_hold: onHold }).eq("id", c.id);
    if (error) throw new Error("Could not update the certificate");
    await db.from("certificate_events").insert({ certificate_id: c.id, event: onHold ? "PAUSED" : "RESUMED", reason: reason.slice(0, 500), actor_id: uid });
  }
  return mine.map((c) => c.certificate_id);
}

export async function pauseAuthorCertificate(uid: string, authorId: string, reason: string) {
  await requireRole(uid, ADMINS);
  const why = reason.trim();
  if (why.length < 5) throw new Error("Record why this certificate is being paused (at least 5 characters)");
  const { a, p } = await loadAuthor(authorId);
  const ins = await dbx.from("author_certificate_holds").upsert({ author_id: a.id, paper_id: a.paper_id, reason: why.slice(0, 500), paused_by: uid, paused_at: new Date().toISOString() }, { onConflict: "author_id" });
  if (ins.error) throw new Error("Could not pause the certificate");
  const ids = await setCertificatesOnHold(a, true, uid, why);
  // An e-mail that already went out cannot be recalled. Say so, so the administrator is not left believing it was.
  const { count } = await dbx.from("email_outbox").select("id", { count: "exact", head: true }).eq("paper_id", a.paper_id).eq("kind", "certificate_issued").eq("status", "SENT");
  await audit({ actor_id: uid, action: "author_certificate_paused", resource_type: "paper", resource_id: a.paper_id, metadata: { public_id: p.public_id, author_id: a.id, author: a.full_name, certificates: ids, reason: why.slice(0, 500) } });
  return { ok: true as const, certificates: ids.length, alreadyEmailed: (count ?? 0) > 0 };
}

export async function resumeAuthorCertificate(uid: string, authorId: string, origin: string) {
  await requireRole(uid, ADMINS);
  const { a, p } = await loadAuthor(authorId);
  const del = await dbx.from("author_certificate_holds").delete().eq("author_id", a.id);
  if (del.error) throw new Error("Could not resume the certificate");
  const ids = await setCertificatesOnHold(a, false, uid, "released by administrator");
  await audit({ actor_id: uid, action: "author_certificate_resumed", resource_type: "paper", resource_id: a.paper_id, metadata: { public_id: p.public_id, author_id: a.id, author: a.full_name, certificates: ids } });
  // If the paper is already published, issue whatever is missing (a certificate that was never created while on hold) and send the completed set.
  const pipe = await import("./pipeline.server");
  const { data: paper } = await db.from("papers").select("status").eq("id", a.paper_id).maybeSingle();
  let issued = false;
  if (paper && ["PUBLISHED", "CORRECTED"].includes(paper.status)) {
    try {
      if (a.user_id) await pipe.issueOwnerPublicationCertificateIfOwner(a.paper_id, a.user_id, origin, uid);
      await pipe.issueAuthorCertificates(a.paper_id, origin);
      issued = true;
    } catch { issued = false; }
  }
  return { ok: true as const, issued };
}


// ---------- corrections: edit names, re-issue, delete (administrators only) ----------
// A certificate is never edited in place (its fingerprint and wording are fixed at issue). A correction marks the old certificate SUPERSEDED
// and issues a new one with the corrected wording and a new ID. Deleting a certificate marks it REVOKED; real deletion is blocked by the database.
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
interface CertRow { id: string; certificate_id: string; certificate_type: string; version_id: string; author_role: string; recipient_user_id: string | null; recipient_author_id: string | null; recipient_email: string | null; recipient_name_at_issue: string; paper_title_at_issue: string; on_hold: boolean | null; status: string }

async function liveCertificates(paperId: string): Promise<CertRow[]> {
  const { data } = await dbx.from("certificates").select("id, certificate_id, certificate_type, version_id, author_role, recipient_user_id, recipient_author_id, recipient_email, recipient_name_at_issue, paper_title_at_issue, on_hold, status").eq("paper_id", paperId).eq("status", "VALID");
  return (data ?? []) as unknown as CertRow[];
}
const belongsTo = (c: CertRow, a: { id: string; user_id: string | null }) => c.recipient_author_id === a.id || (!c.recipient_author_id && !!a.user_id && c.recipient_user_id === a.user_id);

/** Replaces one certificate with a corrected one. The old one is kept (as SUPERSEDED) so its ID still verifies as replaced. */
async function reissueOne(c: CertRow, paperId: string, patch: { name?: string; email?: string | null }, uid: string, why: string, origin: string) {
  const pipe = await import("./pipeline.server");
  const mark = await dbx.from("certificates").update({ status: "SUPERSEDED", status_reason: `Replaced by a corrected certificate: ${why}`.slice(0, 500) } as never).eq("id", c.id);
  if (mark.error) throw new Error("Could not replace the certificate");
  try {
    const newId = await pipe.issueCertificate({
      paperId, versionId: c.version_id, recipientId: c.recipient_user_id, recipientAuthorId: c.recipient_author_id,
      recipientEmail: patch.email !== undefined ? patch.email : c.recipient_email, recipientName: patch.name ?? c.recipient_name_at_issue,
      type: c.certificate_type as "SUBMISSION" | "PUBLICATION" | "AUTHOR_RECORD", role: c.author_role, origin, actorId: uid, holdMail: true,
    });
    if (c.on_hold) await dbx.from("certificates").update({ on_hold: true }).eq("certificate_id", newId);
    await db.from("certificate_events").insert({ certificate_id: c.id, event: "SUPERSEDED", reason: `Replaced by ${newId}: ${why}`.slice(0, 500), actor_id: uid });
    return { oldId: c.certificate_id, newId };
  } catch (e) {
    await dbx.from("certificates").update({ status: "VALID", status_reason: null } as never).eq("id", c.id); // put the old one back, nothing is lost
    throw e;
  }
}

/** Re-issues several certificates at the same time (each one renders a PDF, so one after another would take many seconds each). One failing never stops the rest. */
async function reissueAll(rows: CertRow[], paperId: string, patch: { name?: string; email?: string | null }, uid: string, why: string, origin: string) {
  const replaced: Array<{ oldId: string; newId: string }> = []; let failed = 0;
  const results = await Promise.allSettled(rows.map((c) => reissueOne(c, paperId, patch.email !== undefined && !c.recipient_author_id ? (patch.name !== undefined ? { name: patch.name } : {}) : patch, uid, why, origin)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") replaced.push(r.value);
    else { failed++; log("certificate_reissue_failed", { paperId, certificate: rows[i]?.certificate_id, error: r.reason instanceof Error ? r.reason.message.slice(0, 200) : "unknown" }); }
  });
  return { replaced, failed };
}

async function sendCorrected(paperId: string, send: boolean) {
  if (!send) return false;
  const { count } = await db.from("certificates").select("id", { count: "exact", head: true }).eq("paper_id", paperId).eq("status", "VALID").eq("certificate_type", "PUBLICATION");
  if (!count) return false;
  const r = await (await import("./mail.server")).queueCertificateBundleEmails(paperId);
  return (r?.queued ?? 0) > 0;
}

/** Corrects the article name. Every certificate that carries the old name (not reviewers', which never name the paper) is replaced. */
export async function editArticleTitle(uid: string, paperId: string, newTitle: string, reason: string, resend: boolean, origin: string) {
  await requireRole(uid, ADMINS);
  const why = clean(reason); const title = clean(newTitle);
  if (why.length < 5) throw new Error("Record why the name is being corrected (at least 5 characters)");
  if (title.length < 3 || title.length > 500) throw new Error("The article name must be 3 to 500 characters");
  const { data: p } = await db.from("papers").select("id, public_id, title, doi, deleted_at").eq("id", paperId).maybeSingle();
  if (!p || p.deleted_at) throw new Error("Paper not found");
  if (p.title === title) throw new Error("The name is unchanged");
  const up = await dbx.rpc("admin_correct_article_title", { _paper_id: paperId, _title: title });
  if (up.error) { log("article_title_correction_failed", { paperId, error: up.error.message.slice(0, 200) }); throw new Error(/function .*does not exist|schema cache/i.test(up.error.message) ? "Run migration 0042_admin_correct_names.sql first" : "Could not change the article name"); }
  const todo = (await liveCertificates(paperId)).filter((c) => c.certificate_type !== "PEER_REVIEW" && c.paper_title_at_issue !== title);
  const { replaced, failed } = await reissueAll(todo, paperId, {}, uid, why, origin);
  const emailed = await sendCorrected(paperId, resend && replaced.length > 0);
  await audit({ actor_id: uid, action: "article_title_corrected", resource_type: "paper", resource_id: paperId, metadata: { public_id: p.public_id, from: p.title, to: title, reason: why.slice(0, 500), replaced, failed } });
  return { ok: true as const, replaced: replaced.length, failed, emailed, hasDoi: !!p.doi };
}

/** Corrects an author's name (and optionally e-mail) and replaces that author's certificates. */
export async function editAuthor(uid: string, authorId: string, fullName: string, email: string | null, reason: string, resend: boolean, origin: string) {
  await requireRole(uid, ADMINS);
  const why = clean(reason); const name = clean(fullName);
  if (why.length < 5) throw new Error("Record why this is being corrected (at least 5 characters)");
  if (name.length < 2 || name.length > 200) throw new Error("The author name must be 2 to 200 characters");
  const mail = (email ?? "").trim().toLowerCase();
  if (mail && (!EMAIL_OK.test(mail) || mail.length > 254)) throw new Error("That e-mail address is not valid");
  const { data: a } = await db.from("paper_authors").select("id, paper_id, full_name, email, user_id").eq("id", authorId).maybeSingle();
  if (!a) throw new Error("Author not found");
  const { p } = await loadAuthor(authorId);
  const nameChanged = name !== a.full_name; const mailChanged = mail !== (a.email ?? "").trim().toLowerCase();
  if (!nameChanged && !mailChanged) {
    // Nothing to correct: with the box ticked this simply sends the current certificates again (to every address on record).
    if (!resend) throw new Error("Nothing was changed");
    const emailed = await sendCorrected(a.paper_id, true);
    await audit({ actor_id: uid, action: "author_certificates_resent", resource_type: "paper", resource_id: a.paper_id, metadata: { public_id: p.public_id, author_id: a.id, reason: why.slice(0, 500), emailed } });
    return { ok: true as const, replaced: 0, failed: 0, emailed };
  }
  const up = await dbx.rpc("admin_correct_author", { _author_id: a.id, _full_name: name, _email: mail, _set_email: mailChanged });
  if (up.error) { log("author_correction_failed", { authorId: a.id, error: up.error.message.slice(0, 200) }); throw new Error(/function .*does not exist|schema cache/i.test(up.error.message) ? "Run migration 0042_admin_correct_names.sql first" : "Could not change the author"); }
  const todo = (await liveCertificates(a.paper_id)).filter((x) => belongsTo(x, a) && x.certificate_type !== "PEER_REVIEW");
  const { replaced, failed } = await reissueAll(todo, a.paper_id, { name, ...(mailChanged ? { email: mail || null } : {}) }, uid, why, origin);
  const emailed = await sendCorrected(a.paper_id, resend && replaced.length > 0);
  await audit({ actor_id: uid, action: "author_corrected", resource_type: "paper", resource_id: a.paper_id, metadata: { public_id: p.public_id, author_id: a.id, from: a.full_name, to: name, email_changed: mailChanged, reason: why.slice(0, 500), replaced, failed } });
  return { ok: true as const, replaced: replaced.length, failed, emailed };
}

/** "Deletes" an author's certificates: they are revoked (they stop verifying and downloading) and the author is held so none is issued again until an administrator releases them. */
export async function deleteAuthorCertificate(uid: string, authorId: string, reason: string) {
  await requireRole(uid, ADMINS);
  const why = clean(reason);
  if (why.length < 5) throw new Error("Record why this certificate is being deleted (at least 5 characters)");
  const { a, p } = await loadAuthor(authorId);
  const hold = await dbx.from("author_certificate_holds").upsert({ author_id: a.id, paper_id: a.paper_id, reason: `Deleted: ${why}`.slice(0, 500), paused_by: uid, paused_at: new Date().toISOString() }, { onConflict: "author_id" });
  if (hold.error) throw new Error("Could not delete the certificate");
  const ids: string[] = [];
  for (const c of (await liveCertificates(a.paper_id)).filter((x) => belongsTo(x, a))) {
    const r = await dbx.from("certificates").update({ status: "REVOKED", status_reason: `Deleted by administrator: ${why}`.slice(0, 500), on_hold: true } as never).eq("id", c.id);
    if (r.error) throw new Error("Could not revoke the certificate");
    await db.from("certificate_events").insert({ certificate_id: c.id, event: "REVOKED", reason: why.slice(0, 500), actor_id: uid });
    ids.push(c.certificate_id);
  }
  const { count } = await dbx.from("email_outbox").select("id", { count: "exact", head: true }).eq("paper_id", a.paper_id).eq("kind", "certificate_issued").eq("status", "SENT");
  await audit({ actor_id: uid, action: "author_certificate_deleted", resource_type: "paper", resource_id: a.paper_id, metadata: { public_id: p.public_id, author_id: a.id, author: a.full_name, certificates: ids, reason: why.slice(0, 500) } });
  return { ok: true as const, certificates: ids.length, alreadyEmailed: (count ?? 0) > 0 };
}
