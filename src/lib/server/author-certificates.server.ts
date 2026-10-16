// Admin control over each author's certificate. An administrator can put one author's certificate on hold (for example when that person
// looks suspicious) without affecting the other authors of the same paper. While on hold the author gets no certificate and no certificate
// e-mail, and a certificate that already exists is hidden (Certificates list, download, public verification) until the hold is lifted.
// The reason is internal: it is kept in the audit log and in a table that clients cannot read, and the author is not notified.
import { db, dbx, audit, requireRole, ADMINS } from "./core.server";

interface HoldRow { author_id: string; reason: string; paused_at: string; paused_by: string }

/** Every listed author of a paper with their certificate state. Administrators only. */
export async function listPaperAuthorCertificates(uid: string, paperId: string) {
  await requireRole(uid, ADMINS);
  const { data: paper } = await db.from("papers").select("id, public_id, owner_id, status").eq("id", paperId).maybeSingle();
  if (!paper) throw new Error("Paper not found");
  const { data: authors } = await db.from("paper_authors").select("id, full_name, email, user_id, position").eq("paper_id", paperId).order("position");
  const { data: holds } = await dbx.from("author_certificate_holds").select("author_id, reason, paused_at, paused_by").eq("paper_id", paperId);
  const holdMap = new Map(((holds ?? []) as HoldRow[]).map((h) => [h.author_id, h]));
  const { data: certs } = await db.from("certificates").select("certificate_id, certificate_type, recipient_author_id, recipient_user_id, status").eq("paper_id", paperId);
  const published = ["PUBLISHED", "CORRECTED"].includes(paper.status);
  return {
    published,
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
