// Admin-only removal of an article. Submitted papers can never be hard-deleted (database rule), so a removed article is hidden everywhere
// (public pages, search, sitemap, author lists, queues) while its history, certificates and payment records stay for the audit trail.
import { db, dbx, audit, notify, requireRole, ADMINS, log } from "./core.server";

const norm = (s: string) => s.trim().toUpperCase();

export async function findArticle(uid: string, reference: string) {
  await requireRole(uid, ADMINS);
  const ref = norm(reference);
  if (ref.length < 3) throw new Error("Enter the paper reference, for example PLY-2026-000014");
  const { data } = await db.from("papers").select("id, public_id, paperly_id, title, status, article_type, created_at, deleted_at")
    .or(`paperly_id.eq.${ref.replace(/[^A-Z0-9-]/g, "")},public_id.eq.${ref.replace(/[^A-Z0-9-]/g, "")}`).limit(1).maybeSingle();
  if (!data) throw new Error("No paper has that reference");
  const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("paper_id", data.id).eq("status", "PAID");
  return { ...data, hasPaidFee: (count ?? 0) > 0 };
}

export async function removeArticle(uid: string, paperId: string, reason: string, confirm: string) {
  await requireRole(uid, ADMINS);
  const why = reason.trim();
  if (why.length < 10) throw new Error("Record why the article is being removed (at least 10 characters)");
  const { data: p } = await db.from("papers").select("id, public_id, paperly_id, title, status, owner_id, deleted_at").eq("id", paperId).maybeSingle();
  if (!p) throw new Error("Paper not found");
  if (p.deleted_at) throw new Error("This article has already been removed");
  if (![p.public_id, p.paperly_id].some((r) => r && norm(r) === norm(confirm))) throw new Error("The reference you typed does not match this paper");
  const { error } = await db.from("papers").update({ deleted_at: new Date().toISOString(), deleted_by: uid, deleted_reason: why }).eq("id", paperId).is("deleted_at", null);
  if (error) throw new Error("Could not remove the article");
  await audit({ actor_id: uid, action: "article_removed", resource_type: "paper", resource_id: paperId, metadata: { public_id: p.public_id, paperly_id: p.paperly_id, status: p.status, reason: why.slice(0, 500) } });
  if (p.owner_id) await notify(p.owner_id, "status_update", "Your submission was removed", `${p.public_id} was removed by an administrator and is no longer visible. Contact the editorial team if you have questions.`, "/my-research");
  return { ok: true as const };
}

export async function restoreArticle(uid: string, paperId: string) {
  await requireRole(uid, ADMINS);
  const { data: p } = await db.from("papers").select("id, public_id, deleted_at").eq("id", paperId).maybeSingle();
  if (!p || !p.deleted_at) throw new Error("This article is not removed");
  const { error } = await db.from("papers").update({ deleted_at: null, deleted_by: null, deleted_reason: null }).eq("id", paperId);
  if (error) throw new Error("Could not restore the article");
  await audit({ actor_id: uid, action: "article_restored", resource_type: "paper", resource_id: paperId, metadata: { public_id: p.public_id } });
  return { ok: true as const };
}

export async function listRemoved(uid: string) {
  await requireRole(uid, ADMINS);
  const { data } = await db.from("papers").select("id, public_id, paperly_id, title, status, deleted_at, deleted_reason").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(100);
  return data ?? [];
}

/** Every live (not removed) paper, newest first, optionally narrowed by a search on title or reference. Administrators only. */
export async function listArticles(uid: string, query?: string) {
  await requireRole(uid, ADMINS);
  let q = db.from("papers").select("id, public_id, paperly_id, title, status, article_type, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
  const term = (query ?? "").trim().replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 60);
  if (term.length >= 2) q = q.or(`title.ilike.%${term}%,public_id.ilike.%${term}%,paperly_id.ilike.%${term}%`);
  const { data } = await q;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: paid } = await db.from("payments").select("paper_id").eq("status", "PAID").in("paper_id", rows.map((r) => r.id));
  const paidSet = new Set((paid ?? []).map((r) => r.paper_id));
  return rows.map((r) => ({ ...r, hasPaidFee: paidSet.has(r.id) }));
}

/** Permanently erases a paper that was already deleted, with everything attached to it (versions, reviews, payments, certificates, declarations),
 *  and then its files in storage. A snapshot of what was erased, including payments, stays in the audit log. This cannot be undone. */
export async function eraseArticle(uid: string, paperId: string, reason: string, confirm: string) {
  await requireRole(uid, ADMINS);
  const why = reason.trim();
  if (why.length < 10) throw new Error("Record why the article is being erased (at least 10 characters)");
  const { data: p } = await db.from("papers").select("id, public_id, paperly_id, deleted_at").eq("id", paperId).maybeSingle();
  if (!p) throw new Error("Paper not found");
  if (!p.deleted_at) throw new Error("Delete the article first. Only a deleted article can be erased permanently");
  if (![p.public_id, p.paperly_id].some((r) => r && norm(r) === norm(confirm))) throw new Error("The reference you typed does not match this paper");
  const { data, error } = await dbx.rpc("admin_purge_paper", { _paper: paperId, _actor: uid, _reason: why });
  if (error) { log("article_erase_failed", { paperId, error: error.message }); throw new Error("Could not erase the article. Nothing was changed"); }
  const res = (data ?? {}) as { rows?: Record<string, number>; manuscript_paths?: string[]; certificate_paths?: string[] };
  // The database rows are gone. Files are removed afterwards; if this fails the files are orphaned, never the database half-erased.
  const files = { manuscripts: 0, certificates: 0, failed: 0 };
  for (const [bucket, paths, key] of [["manuscripts", res.manuscript_paths ?? [], "manuscripts"], ["certificates", res.certificate_paths ?? [], "certificates"]] as const) {
    if (paths.length === 0) continue;
    const r = await db.storage.from(bucket).remove(paths);
    if (r.error) { files.failed += paths.length; log("article_erase_storage_failed", { paperId, bucket, error: r.error.message }); } else files[key] += paths.length;
  }
  await audit({ actor_id: uid, action: "article_erased_files", resource_type: "paper", resource_id: paperId, metadata: { public_id: p.public_id, files } });
  return { ok: true as const, rows: res.rows ?? {}, files };
}
