import { db, dbx, audit, notify, transition, requireRole, getRoles, STAFF, ADMINS } from "./core.server";
import { authorSeesReviewers, decisionColumns, decisionTarget, outcomeAllowed, reviewerSeesAuthors, AUTHOR_REVIEW_HIDDEN_STATUSES, type EditorialOutcome, type ReviewModel } from "@/lib/domain/review";
import { canAssignRole, canChangeRolesOf } from "@/lib/domain/permissions";
import { scanManuscript, manuscriptKind, kindMime, sha256Hex, MAX_UPLOAD_BYTES } from "@/lib/domain/file-security";

const DAY = 86_400_000;
export type OpenClaims = "OPEN" | "APPROVAL" | "OFF";

export async function getSettings() {
  const { data } = await db.from("editorial_settings").select("*").eq("id", true).single();
  return data ?? { id: true, journal_mode_enabled: false, default_review_model: "DOUBLE_ANONYMOUS", reviews_required: 2, review_days: 21, updated_by: null, updated_at: "" };
}

async function loadPaper(paperId: string) {
  const { data } = await db.from("papers").select("id, title, status, owner_id, publication_type, handling_editor_id, review_model, review_round, current_version_id, open_claims, deleted_at").eq("id", paperId).single();
  if (!data || data.deleted_at) throw new Error("Not found"); // a removed article is out of every workflow
  return data;
}
async function isConflicted(paperId: string, uid: string, ownerId: string) {
  if (ownerId === uid) return true;
  const { data } = await db.from("paper_authors").select("id").eq("paper_id", paperId).eq("user_id", uid).limit(1);
  return (data?.length ?? 0) > 0;
}
/** Staff who are not conflicted; must be the handling editor unless admin. */
async function requireHandlingEditor(paperId: string, uid: string) {
  const roles = await requireRole(uid, STAFF);
  const paper = await loadPaper(paperId);
  if (await isConflicted(paperId, uid, paper.owner_id)) throw new Error("Conflict of interest: you cannot handle a manuscript you submitted or authored");
  const isAdmin = roles.some((r) => ADMINS.includes(r));
  if (paper.handling_editor_id && paper.handling_editor_id !== uid && !isAdmin) throw new Error("This manuscript is assigned to another editor");
  return paper;
}

// ---------------- editor ----------------
export async function setPublicationType(paperId: string, uid: string, type: "REPOSITORY_RECORD" | "PREPRINT" | "JOURNAL_ARTICLE") {
  const paper = await requireHandlingEditor(paperId, uid);
  if (paper.status !== "REVIEW_REQUIRED") throw new Error("The record type can only be changed during editorial screening");
  if (type === "JOURNAL_ARTICLE" && !(await getSettings()).journal_mode_enabled) throw new Error("Journal mode is not enabled. An administrator must enable it first.");
  await db.from("papers").update({ publication_type: type }).eq("id", paperId);
  await audit({ actor_id: uid, action: "publication_type_set", resource_type: "paper", resource_id: paperId, old_value: { publication_type: paper.publication_type }, new_value: { publication_type: type } });
}

export async function startPeerReview(paperId: string, uid: string) {
  const paper = await requireHandlingEditor(paperId, uid);
  if (paper.status !== "REVIEW_REQUIRED") throw new Error("Paper is not in editorial screening");
  const s = await getSettings();
  const model = paper.review_model ?? s.default_review_model;
  await db.from("papers").update({ handling_editor_id: uid, review_model: model }).eq("id", paperId);
  await transition(paperId, "REVIEWER_ASSIGNMENT", uid, "USER", "editor started peer review");
  await audit({ actor_id: uid, action: "editor_assigned", resource_type: "paper", resource_id: paperId, new_value: { handling_editor_id: uid, review_model: model } });
}

export async function inviteReviewer(paperId: string, uid: string, reviewerId: string, days?: number) {
  const paper = await requireHandlingEditor(paperId, uid);
  if (!["REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"].includes(paper.status)) throw new Error("Reviewers can be invited only while the paper is in peer review");
  if (!(await getRoles(reviewerId)).includes("reviewer")) throw new Error("That user does not have the reviewer role");
  if (await isConflicted(paperId, reviewerId, paper.owner_id)) throw new Error("A reviewer cannot review a paper they submitted or authored");
  const model = (paper.review_model ?? "DOUBLE_ANONYMOUS") as ReviewModel;
  const { data: ver } = await db.from("paper_versions").select("id, anonymized_storage_path").eq("id", paper.current_version_id!).single();
  if (model === "DOUBLE_ANONYMOUS" && !ver?.anonymized_storage_path) throw new Error("Double-anonymous review needs an anonymized manuscript file. Ask the authors to supply one.");
  const s = await getSettings();
  const due = new Date(Date.now() + (days ?? s.review_days) * DAY).toISOString();
  const { data: row, error } = await db.from("review_assignments").insert({ paper_id: paperId, reviewer_id: reviewerId, assigned_by: uid, status: "INVITED", round: paper.review_round, version_id: paper.current_version_id!, due_at: due }).select("id").single();
  if (error || !row) throw new Error(error?.code === "23505" ? "This reviewer was already invited for this round" : "Could not invite reviewer");
  if (paper.status === "EDITORIAL_DECISION") await transition(paperId, "REVIEWER_ASSIGNMENT", uid, "USER", "additional reviewer invited");
  // The invitation shows the title only. Author identity is never included.
  await notify(reviewerId, "review_invitation", "Invitation to review", `You are invited to review “${paper.title}”. Please respond by ${due.slice(0, 10)}.`, "/reviews");
  await audit({ actor_id: uid, action: "reviewer_invited", resource_type: "paper", resource_id: paperId, metadata: { assignment_id: row.id, round: paper.review_round } });
  return { id: row.id };
}

export async function replaceReviewer(assignmentId: string, uid: string, newReviewerId: string) {
  const { data: a } = await db.from("review_assignments").select("id, paper_id, status").eq("id", assignmentId).single();
  if (!a) throw new Error("Not found");
  await requireHandlingEditor(a.paper_id, uid);
  if (a.status === "COMPLETED") throw new Error("A completed review cannot be replaced");
  // Invite first: if the new invitation is refused, the old reviewer stays in place.
  const inv = await inviteReviewer(a.paper_id, uid, newReviewerId);
  await db.from("review_assignments").update({ status: "REPLACED" }).eq("id", assignmentId);
  await audit({ actor_id: uid, action: "reviewer_replaced", resource_type: "paper", resource_id: a.paper_id, metadata: { assignment_id: assignmentId, replacement_id: inv.id } });
  return inv;
}

export async function extendDeadline(assignmentId: string, uid: string, days: number) {
  const { data: a } = await db.from("review_assignments").select("id, paper_id, status, due_at, reviewer_id").eq("id", assignmentId).single();
  if (!a) throw new Error("Not found");
  await requireHandlingEditor(a.paper_id, uid);
  if (!["INVITED", "ACCEPTED"].includes(a.status)) throw new Error("Only open reviews can be extended");
  const base = Math.max(Date.now(), a.due_at ? Date.parse(a.due_at) : 0);
  const due = new Date(base + days * DAY).toISOString();
  await db.from("review_assignments").update({ due_at: due }).eq("id", assignmentId);
  await notify(a.reviewer_id, "review_deadline", "Review deadline extended", `Your new deadline is ${due.slice(0, 10)}.`, "/reviews");
  await audit({ actor_id: uid, action: "review_deadline_extended", resource_type: "paper", resource_id: a.paper_id, new_value: { due_at: due } });
}

export async function editorReviews(paperId: string, uid: string) {
  const paper = await requireHandlingEditor(paperId, uid);
  const { data: rows } = await db.from("review_assignments").select("*").eq("paper_id", paperId).order("assigned_at");
  const ids = Array.from(new Set((rows ?? []).map((r) => r.reviewer_id)));
  const { data: profs } = ids.length ? await db.from("profiles").select("id, display_name, institution").in("id", ids) : { data: [] as Array<{ id: string; display_name: string; institution: string | null }> };
  const pm = new Map((profs ?? []).map((p) => [p.id, p]));
  const settings = await getSettings();
  return {
    paper: { status: paper.status, publication_type: paper.publication_type, review_model: paper.review_model, review_round: paper.review_round, open_claims: paper.open_claims as OpenClaims },
    reviewsRequired: settings.reviews_required, journalMode: settings.journal_mode_enabled,
    reviews: (rows ?? []).map((r) => ({ ...r, reviewer_name: pm.get(r.reviewer_id)?.display_name ?? "Reviewer", reviewer_institution: pm.get(r.reviewer_id)?.institution ?? null })),
  };
}

export async function closeReviews(paperId: string, uid: string, reason: string) {
  const paper = await requireHandlingEditor(paperId, uid);
  if (paper.status !== "PEER_REVIEW") throw new Error("Paper is not under peer review");
  const { count } = await db.from("review_assignments").select("id", { count: "exact", head: true }).eq("paper_id", paperId).eq("status", "COMPLETED");
  if ((count ?? 0) < 1) throw new Error("At least one completed review is needed before a decision");
  await db.from("review_assignments").update({ status: "EXPIRED" }).eq("paper_id", paperId).in("status", ["INVITED", "REQUESTED", "ACCEPTED"]);
  await transition(paperId, "EDITORIAL_DECISION", uid, "USER", `editor closed reviews: ${reason}`);
}

export async function recordDecision(paperId: string, uid: string, outcome: EditorialOutcome, reason?: string, origin = "") {
  const note = reason?.trim() || "";
  const paper = await requireHandlingEditor(paperId, uid);
  const { count } = await db.from("review_assignments").select("id", { count: "exact", head: true }).eq("paper_id", paperId).eq("status", "COMPLETED");
  const blocked = outcomeAllowed({ status: paper.status, publicationType: paper.publication_type, outcome, completedReviews: count ?? 0 });
  if (blocked) throw new Error(blocked);
  const cols = decisionColumns(outcome);
  const ins = await db.from("decisions").insert({ paper_id: paperId, version_id: paper.current_version_id, source: "HUMAN", outcome: cols.outcome, revision_type: cols.revision_type, reasons: (note ? [{ code: "EDITOR", message: note }] : []) as never, check_summary: {} as never, actor_id: uid });
  if (ins.error) throw new Error("Could not record the decision");
  const to = decisionTarget(outcome);
  // Only a record that actually completed review may carry the peer-reviewed flag (DB trigger enforces it too).
  if (to === "ACCEPTED" && (count ?? 0) > 0) await db.from("papers").update({ peer_reviewed: true }).eq("id", paperId);
  await transition(paperId, to, uid, "USER", note || `editor decision: ${outcome}`);
  // The fee is paid at upload. An accepted paper that already paid goes straight to production; a rejected one gets the refund (300 kept).
  let refundNote = "";
  if (to === "ACCEPTED" || to === "REJECTED") {
    const payments = await import("./payments.server");
    if (to === "ACCEPTED" && await payments.feeCleared(paperId)) {
      await transition(paperId, "PUBLICATION_PENDING", null, "SYSTEM", "fee settled at upload; awaiting production");
      // Approval is the human gate; production follows automatically. If it fails the paper waits in PUBLICATION_PENDING for staff.
      await (await import("./pipeline.server")).autoPublish(paperId, origin);
    } else if (to === "REJECTED") {
      const r = await payments.refundOnRejection(paperId, uid, "");
      if (r.refunded) refundNote = ` Your fee has been refunded except ${r.retainedMinor / 100} INR; the refund goes back to your original payment method.`;
      else if (r.reason !== "no paid fee") refundNote = " Your refund could not be completed automatically; the editorial team has been notified and will complete it.";
    }
  }
  await audit({ actor_id: uid, action: "editorial_decision", resource_type: "paper", resource_id: paperId, old_value: { status: paper.status }, new_value: { outcome, status: to } });
  const { count: changes } = await dbx.from("editorial_edits").select("id", { count: "exact", head: true }).eq("paper_id", paperId).in("status", ["PROPOSED", "ACCEPTED"]);
  const head = outcome === "ACCEPT" ? "Your research paper has been approved and submitted." : outcome === "REJECT" ? "The editor has disapproved your research paper." : "The editor asks for changes to your research paper.";
  const seen = (changes ?? 0) > 0 ? ` The editor made ${changes} tracked change${changes === 1 ? "" : "s"} to your title, abstract or keywords; you can see them on your manuscript page.` : "";
  await notify(paper.owner_id, `decision_${to.toLowerCase()}`, "Editorial decision", `${head}${note ? ` ${note}` : ""}${seen}${refundNote}`, `/my-research/${paperId}`);
}

export async function listReviewers(uid: string) {
  await requireRole(uid, STAFF);
  const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "reviewer");
  const ids = (roles ?? []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data } = await db.from("profiles").select("id, display_name, institution").in("id", ids).order("display_name");
  return data ?? [];
}

// ---------------- reviewer ----------------
export async function myInvitations(uid: string) {
  const { data: rows } = await db.from("review_assignments").select("id, paper_id, status, assigned_at, due_at, responded_at, completed_at, recommendation, round").eq("reviewer_id", uid).order("assigned_at", { ascending: false });
  const pids = Array.from(new Set((rows ?? []).map((r) => r.paper_id)));
  const { data: papers } = pids.length ? await db.from("papers").select("id, title, abstract, article_type").in("id", pids) : { data: [] as Array<{ id: string; title: string; abstract: string; article_type: string }> };
  const pm = new Map((papers ?? []).map((p) => [p.id, p]));
  // Title, abstract and type only: no author information is ever returned here.
  return (rows ?? []).map((r) => ({ ...r, title: pm.get(r.paper_id)?.title ?? "", abstract: r.status === "INVITED" ? pm.get(r.paper_id)?.abstract ?? "" : null, article_type: pm.get(r.paper_id)?.article_type ?? "" }));
}

async function ownAssignment(id: string, uid: string) {
  const { data } = await db.from("review_assignments").select("*").eq("id", id).eq("reviewer_id", uid).maybeSingle();
  if (!data) throw new Error("Not found");
  return data;
}

export async function respondToInvitation(id: string, uid: string, accept: boolean, coi: "NONE" | "POTENTIAL" | "CONFLICT", coiStatement?: string) {
  const a = await ownAssignment(id, uid);
  if (a.status !== "INVITED") throw new Error("This invitation has already been answered");
  if (accept && coi === "POTENTIAL" && (coiStatement ?? "").trim().length < 5) throw new Error("Describe the potential conflict of interest");
  const paper = await loadPaper(a.paper_id);
  const declined = !accept || coi === "CONFLICT";
  await db.from("review_assignments").update({ status: declined ? "DECLINED" : "ACCEPTED", coi_status: coi, coi_statement: coiStatement?.trim() || null, responded_at: new Date().toISOString() }).eq("id", id).eq("status", "INVITED");
  if (!declined && paper.status === "REVIEWER_ASSIGNMENT") await transition(a.paper_id, "PEER_REVIEW", null, "SYSTEM", "a reviewer accepted");
  if (paper.handling_editor_id) await notify(paper.handling_editor_id, declined ? "review_declined" : "review_accepted", declined ? "Reviewer declined" : "Reviewer accepted", `Invitation for “${paper.title}” was ${declined ? "declined" : "accepted"}.`, "/admin");
  await audit({ actor_id: uid, action: declined ? "reviewer_declined" : "reviewer_accepted", resource_type: "paper", resource_id: a.paper_id, metadata: { assignment_id: id, coi } });
}

export async function reviewerManuscript(id: string, uid: string) {
  const a = await ownAssignment(id, uid);
  if (!["ACCEPTED", "COMPLETED"].includes(a.status)) throw new Error("Accept the invitation first");
  const paper = await loadPaper(a.paper_id);
  const model = (paper.review_model ?? "DOUBLE_ANONYMOUS") as ReviewModel;
  const { data: ver } = await db.from("paper_versions").select("storage_path, anonymized_storage_path").eq("id", a.version_id ?? paper.current_version_id!).single();
  const path = model === "DOUBLE_ANONYMOUS" ? ver?.anonymized_storage_path : ver?.storage_path;
  if (!path) throw new Error("The manuscript file for this review model is not available");
  const { data: signed } = await db.storage.from("manuscripts").createSignedUrl(path, 300);
  const { data: full } = await db.from("papers").select("title, abstract, keywords, article_type, field").eq("id", a.paper_id).single();
  let authors: Array<{ full_name: string; affiliation: string | null }> | null = null;
  if (reviewerSeesAuthors(model)) {
    const { data } = await db.from("paper_authors").select("full_name, affiliation").eq("paper_id", a.paper_id).order("position");
    authors = data ?? [];
  }
  return { ...full, review_model: model, due_at: a.due_at, round: a.round, status: a.status, url: signed?.signedUrl ?? null, authors };
}

export async function submitReview(id: string, uid: string, input: { recommendation: EditorialOutcome; comments_to_author?: string | undefined; confidential_to_editor?: string | undefined }) {
  const a = await ownAssignment(id, uid);
  if (a.status !== "ACCEPTED") throw new Error("This review cannot be submitted");
  const paper = await loadPaper(a.paper_id);
  if (paper.status !== "PEER_REVIEW") throw new Error("The paper is no longer under review");
  const now = new Date().toISOString();
  const upd = await db.from("review_assignments").update({ status: "COMPLETED", recommendation: input.recommendation, comments_to_author: input.comments_to_author?.trim() || null, confidential_to_editor: input.confidential_to_editor?.trim() || null, completed_at: now }).eq("id", id).eq("reviewer_id", uid).eq("status", "ACCEPTED").select("id");
  if (upd.error || !upd.data?.length) throw new Error("Could not save the review");
  await audit({ actor_id: uid, action: "review_submitted", resource_type: "paper", resource_id: a.paper_id, metadata: { assignment_id: id, late: a.due_at ? Date.parse(a.due_at) < Date.now() : false } });
  const { count } = await db.from("review_assignments").select("id", { count: "exact", head: true }).eq("paper_id", a.paper_id).eq("round", a.round).eq("status", "COMPLETED");
  const need = (await getSettings()).reviews_required;
  if ((count ?? 0) >= need) await transition(a.paper_id, "EDITORIAL_DECISION", null, "SYSTEM", "required number of reviews completed");
  // The reviewer's certificate (confidential: it does not name the manuscript). Never blocks the review.
  await (await import("./pipeline.server")).issueReviewerCertificate(id);
  if (paper.handling_editor_id) await notify(paper.handling_editor_id, "review_submitted", "Review submitted", `A review for “${paper.title}” was submitted.`, "/admin");
}

// ---------------- author ----------------
export async function authorReviews(paperId: string, uid: string) {
  const paper = await loadPaper(paperId);
  if (paper.owner_id !== uid) throw new Error("Not found");
  // Review content is released to the author only together with the editorial decision.
  if (AUTHOR_REVIEW_HIDDEN_STATUSES.includes(paper.status)) return { visible: false as const, review_model: null, reviews: [] as Array<{ round: number; recommendation: string | null; comments: string | null; completed_at: string | null; reviewer: string }> };
  const model = (paper.review_model ?? "DOUBLE_ANONYMOUS") as ReviewModel;
  const { data: rows } = await db.from("review_assignments").select("reviewer_id, round, recommendation, comments_to_author, completed_at").eq("paper_id", paperId).eq("status", "COMPLETED").order("round").order("completed_at");
  const ids = Array.from(new Set((rows ?? []).map((r) => r.reviewer_id)));
  const { data: profs } = authorSeesReviewers(model) && ids.length ? await db.from("profiles").select("id, display_name").in("id", ids) : { data: [] as Array<{ id: string; display_name: string }> };
  const names = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
  const order = new Map(ids.map((rid, i) => [rid, i + 1]));
  // Confidential comments and (unless open review) reviewer identity are never returned to authors.
  return { visible: true as const, review_model: model as string | null, reviews: (rows ?? []).map((r) => ({ round: r.round, recommendation: r.recommendation, comments: r.comments_to_author, completed_at: r.completed_at, reviewer: authorSeesReviewers(model) ? names.get(r.reviewer_id) ?? "Reviewer" : `Reviewer ${order.get(r.reviewer_id)}` })) };
}

export async function resubmitRevision(uid: string, args: { paperId: string; file: File; anonymized?: File | undefined; response: string; summary: string }) {
  const paper = await loadPaper(args.paperId);
  if (paper.owner_id !== uid) throw new Error("Not found");
  if (paper.status !== "REVISION_REQUIRED") throw new Error("A revision was not requested for this paper");
  const model = paper.review_model as ReviewModel | null;
  if (model === "DOUBLE_ANONYMOUS" && !args.anonymized) throw new Error("Attach an anonymized copy of the revised manuscript for double-anonymous review");
  // Phase 8: validation, storage upload, ONE atomic database commit (version row + reviewer response + paper pointer + status + audit)
  // and storage compensation live in versions.server.ts / commit_new_version. This function only decides the numbering step.
  const { preparePdf, submitRevisionVersion } = await import("./versions.server");
  const main = await preparePdf(args.file, "The revised manuscript");
  const anon = args.anonymized ? await preparePdf(args.anonymized, "The anonymized copy") : null;
  const { data: dec } = await db.from("decisions").select("revision_type").eq("paper_id", args.paperId).eq("source", "HUMAN").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const bump = (dec?.revision_type as "MINOR" | "MAJOR" | null) === "MAJOR" ? "MAJOR" : "MINOR";
  const out = await submitRevisionVersion(uid, { paperId: args.paperId, file: main, anon, bump, summary: args.summary, response: args.response });
  if (paper.handling_editor_id) await notify(paper.handling_editor_id, "revision_submitted", "Revision submitted", `A revision of “${paper.title}” was submitted.`, "/admin");
  await notify(paper.owner_id, "revision_received", "We received your revised manuscript", `Your revision of “${paper.title}” (version ${out.version}) was received and sent to the editor.`, `/my-research/${args.paperId}`);
  return { version: out.version };
}

export async function withdrawPaper(paperId: string, uid: string, reason: string) {
  const paper = await loadPaper(paperId);
  if (paper.owner_id !== uid) throw new Error("Not found");
  if (!["SUBMITTED", "REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION", "REVISION_REQUIRED"].includes(paper.status)) throw new Error("This submission can no longer be withdrawn here. Contact the editorial office.");
  await db.from("review_assignments").update({ status: "EXPIRED" }).eq("paper_id", paperId).in("status", ["INVITED", "REQUESTED", "ACCEPTED"]);
  await transition(paperId, "WITHDRAWN", uid, "USER", reason);
  await audit({ actor_id: uid, action: "withdrawn_by_author", resource_type: "paper", resource_id: paperId, metadata: { reason } });
  if (paper.handling_editor_id) await notify(paper.handling_editor_id, "paper_withdrawn", "Submission withdrawn", `“${paper.title}” was withdrawn by the author.`, "/admin");
  await notify(paper.owner_id, "submission_withdrawn", "Your submission was withdrawn", `“${paper.title}” was withdrawn as you requested. It is no longer under review.`, `/my-research/${paperId}`);
}

// ---------------- admin ----------------
export async function updateSettings(uid: string, s: { journal_mode_enabled?: boolean | undefined; default_review_model?: ReviewModel | undefined; reviews_required?: number | undefined; review_days?: number | undefined }) {
  await requireRole(uid, ADMINS);
  const patch = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
  await db.from("editorial_settings").update({ ...patch, updated_by: uid, updated_at: new Date().toISOString() }).eq("id", true);
  await audit({ actor_id: uid, action: "editorial_settings_updated", resource_type: "settings", resource_id: "editorial", new_value: patch });
}

export async function setRole(uid: string, target: { userId?: string | undefined; email?: string | undefined }, role: "editor" | "reviewer" | "founder" | "admin", grant: boolean) {
  const actorRoles = await getRoles(uid);
  const q = db.from("profiles").select("id, email");
  const { data: p } = target.userId ? await q.eq("id", target.userId).maybeSingle() : await q.ilike("email", (target.email ?? "").trim()).maybeSingle();
  if (!p) throw new Error("No account with that email. The person must sign in to Paperly once before a role can be given.");
  const allowed = canAssignRole(actorRoles, role, p.id === uid);
  if (!allowed.ok) throw new Error(allowed.reason);
  const hierarchy = canChangeRolesOf(actorRoles, await getRoles(p.id));
  if (!hierarchy.ok) throw new Error(hierarchy.reason);
  if (role === "admin" && grant) {
    const { data: held } = await db.from("user_roles").select("user_id").in("role", ["admin", "super_admin"]);
    const holders = new Set((held ?? []).map((r) => r.user_id));
    if (!holders.has(p.id) && holders.size >= 2) throw new Error("There can be at most two administrators");
  }
  // Errors are surfaced, never swallowed: a failed grant used to look like a success.
  const res = grant
    ? await db.from("user_roles").upsert({ user_id: p.id, role, granted_by: uid }, { onConflict: "user_id,role", ignoreDuplicates: true })
    : await db.from("user_roles").delete().eq("user_id", p.id).eq("role", role);
  if (res.error) throw new Error(`The role could not be ${grant ? "granted" : "removed"}: ${res.error.message}`);
  const { data: now } = await db.from("user_roles").select("role").eq("user_id", p.id);
  const roles = (now ?? []).map((r) => r.role);
  if (roles.includes(role) !== grant) throw new Error("The role change did not take effect. Please try again.");
  await audit({ actor_id: uid, action: grant ? "role_granted" : "role_revoked", resource_type: "user", resource_id: p.id, metadata: { role } });
  return { id: p.id, email: p.email, roles };
}

/** Author supplies (or replaces) the anonymized copy of the current version, only before any reviewer has accepted. */
export async function addAnonymizedCopy(uid: string, paperId: string, file: File) {
  const paper = await loadPaper(paperId);
  if (paper.owner_id !== uid) throw new Error("Not found");
  if (!["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT"].includes(paper.status)) throw new Error("An anonymized copy can only be added before peer review begins");
  const { count } = await db.from("review_assignments").select("id", { count: "exact", head: true }).eq("paper_id", paperId).in("status", ["ACCEPTED", "COMPLETED"]);
  if ((count ?? 0) > 0) throw new Error("A reviewer has already opened this manuscript");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("The file is larger than 25 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const scan = scanManuscript(bytes, file.name, file.type);
  if (!scan.passed) throw new Error(`File rejected: ${scan.reasons.join("; ")}`);
  const hash = await sha256Hex(bytes);
  const kind = manuscriptKind(file.name) ?? "pdf";
  const path = `${uid}/${paperId}/anon-${hash.slice(0, 12)}.${kind}`;
  const up = await db.storage.from("manuscripts").upload(path, bytes, { contentType: kindMime(kind) });
  if (up.error && !/exists/i.test(up.error.message)) throw new Error("Upload failed. Please try again.");
  await db.from("paper_versions").update({ anonymized_storage_path: path, anonymized_file_hash: hash }).eq("id", paper.current_version_id!);
  await audit({ actor_id: uid, action: "anonymized_copy_added", resource_type: "paper", resource_id: paperId, metadata: { file_hash: hash } });
}

// ---------------- open for review ----------------
const LIVE_REVIEW = ["INVITED", "ACCEPTED", "COMPLETED"];

/** Papers that are waiting for reviewers and still have a place free. Every reviewer sees these, not only the person an editor invited.
 *  Title, abstract and type only: no author information is ever returned here. */
export async function openForReview(uid: string) {
  if (!(await getRoles(uid)).includes("reviewer")) return [];
  const need = (await getSettings()).reviews_required;
  const { data: papers } = await db.from("papers").select("id, title, abstract, article_type, review_model, review_round, current_version_id, owner_id, status, open_claims, updated_at").in("status", ["REVIEWER_ASSIGNMENT", "PEER_REVIEW"]).order("updated_at", { ascending: true }).limit(100);
  const list = papers ?? [];
  if (!list.length) return [];
  const ids = list.map((p) => p.id);
  const { data: asg } = await db.from("review_assignments").select("paper_id, reviewer_id, status, round").in("paper_id", ids);
  const { data: vers } = await db.from("paper_versions").select("id, anonymized_storage_path").in("id", list.map((p) => p.current_version_id).filter((x): x is string => !!x));
  const anon = new Map((vers ?? []).map((v) => [v.id, !!v.anonymized_storage_path]));
  const { data: authored } = await db.from("paper_authors").select("paper_id").eq("user_id", uid).in("paper_id", ids);
  const mine = new Set((authored ?? []).map((a) => a.paper_id));
  const out: Array<{ id: string; title: string; abstract: string; article_type: string; round: number; slotsLeft: number; needsApproval: boolean }> = [];
  for (const p of list) {
    if (p.open_claims === "OFF") continue; // the editor keeps this paper invitation-only
    if (p.owner_id === uid || mine.has(p.id)) continue;
    const rows = (asg ?? []).filter((a) => a.paper_id === p.id);
    if (rows.some((a) => a.reviewer_id === uid && a.round === p.review_round)) continue;
    if ((p.review_model ?? "DOUBLE_ANONYMOUS") === "DOUBLE_ANONYMOUS" && !anon.get(p.current_version_id ?? "")) continue;
    const live = rows.filter((a) => a.round === p.review_round && LIVE_REVIEW.includes(a.status)).length;
    if (live >= need) continue;
    out.push({ id: p.id, title: p.title, abstract: p.abstract, article_type: p.article_type, round: p.review_round, slotsLeft: need - live, needsApproval: p.open_claims === "APPROVAL" });
  }
  return out;
}

/** A reviewer takes a free place on a paper that is waiting for reviewers. It works like accepting an invitation. */
export async function claimReview(paperId: string, uid: string, coi: "NONE" | "POTENTIAL", coiStatement?: string) {
  if (!(await getRoles(uid)).includes("reviewer")) throw new Error("Only reviewers can take a review");
  if (coi === "POTENTIAL" && (coiStatement ?? "").trim().length < 5) throw new Error("Describe the potential conflict of interest");
  const paper = await loadPaper(paperId);
  if (!["REVIEWER_ASSIGNMENT", "PEER_REVIEW"].includes(paper.status)) throw new Error("This paper is no longer waiting for reviewers");
  if (paper.open_claims === "OFF") throw new Error("The editor has not opened this paper to self-selected reviewers");
  if (await isConflicted(paperId, uid, paper.owner_id)) throw new Error("A reviewer cannot review a paper they submitted or authored");
  const model = (paper.review_model ?? "DOUBLE_ANONYMOUS") as ReviewModel;
  const { data: ver } = await db.from("paper_versions").select("id, anonymized_storage_path").eq("id", paper.current_version_id!).single();
  if (model === "DOUBLE_ANONYMOUS" && !ver?.anonymized_storage_path) throw new Error("The anonymized manuscript is not ready yet");
  const s = await getSettings();
  if (paper.open_claims === "APPROVAL") {
    // A request holds no place and gives no access to the manuscript until the editor approves it.
    const now0 = new Date().toISOString();
    const { data: req, error: reqErr } = await db.from("review_assignments").insert({ paper_id: paperId, reviewer_id: uid, assigned_by: paper.handling_editor_id ?? uid, status: "REQUESTED", coi_status: coi, coi_statement: coiStatement?.trim() || null, responded_at: now0, round: paper.review_round, version_id: paper.current_version_id!, due_at: null }).select("id").single();
    if (reqErr || !req) throw new Error(reqErr?.code === "23505" ? "You already have a request or review on this paper" : "Could not send your request");
    if (paper.handling_editor_id) await notify(paper.handling_editor_id, "review_requested", "Review requested", `A reviewer asked to review “${paper.title}”. Approve or decline the request on the manuscript.`, "/admin");
    await audit({ actor_id: uid, action: "reviewer_requested", resource_type: "paper", resource_id: paperId, metadata: { assignment_id: req.id, coi, source: "open_list" } });
    return { id: req.id, pending: true as const };
  }
  const now = new Date().toISOString();
  const due = new Date(Date.now() + s.review_days * DAY).toISOString();
  const { data: row, error } = await db.from("review_assignments").insert({ paper_id: paperId, reviewer_id: uid, assigned_by: paper.handling_editor_id ?? uid, status: "ACCEPTED", coi_status: coi, coi_statement: coiStatement?.trim() || null, responded_at: now, round: paper.review_round, version_id: paper.current_version_id!, due_at: due }).select("id, assigned_at").single();
  if (error || !row) throw new Error(error?.code === "23505" ? "You already have a review on this paper" : "Could not take this review");
  // Two reviewers can press the button together: places are counted again in order of arrival, and anyone past the limit is turned away.
  const { data: live } = await db.from("review_assignments").select("id, assigned_at").eq("paper_id", paperId).eq("round", paper.review_round).in("status", LIVE_REVIEW).order("assigned_at", { ascending: true }).order("id", { ascending: true });
  if ((live ?? []).findIndex((a) => a.id === row.id) >= s.reviews_required) {
    await db.from("review_assignments").delete().eq("id", row.id);
    throw new Error("Another reviewer has just taken the last place on this paper");
  }
  if (paper.status === "REVIEWER_ASSIGNMENT") await transition(paperId, "PEER_REVIEW", null, "SYSTEM", "a reviewer accepted");
  if (paper.handling_editor_id) await notify(paper.handling_editor_id, "review_accepted", "Reviewer accepted", `A reviewer took “${paper.title}” from the open list.`, "/admin");
  await audit({ actor_id: uid, action: "reviewer_accepted", resource_type: "paper", resource_id: paperId, metadata: { assignment_id: row.id, coi, source: "open_list" } });
  return { id: row.id, pending: false as const };
}

// ---------------- editor control over the open list ----------------
export async function setOpenClaims(paperId: string, uid: string, mode: OpenClaims) {
  const paper = await requireHandlingEditor(paperId, uid);
  if (!["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW"].includes(paper.status)) throw new Error("The open list can only be changed before the editorial decision");
  if (paper.open_claims === mode) return;
  await db.from("papers").update({ open_claims: mode }).eq("id", paperId);
  // Turning the list off must not leave requests hanging.
  if (mode === "OFF") {
    const { data: pend } = await db.from("review_assignments").select("id, reviewer_id").eq("paper_id", paperId).eq("round", paper.review_round).eq("status", "REQUESTED");
    if ((pend ?? []).length) {
      await db.from("review_assignments").update({ status: "DECLINED" }).eq("paper_id", paperId).eq("round", paper.review_round).eq("status", "REQUESTED");
      for (const r of pend ?? []) await notify(r.reviewer_id, "review_request_declined", "Review request closed", `The editor closed the open list for “${paper.title}”, so your request was not taken forward.`, "/reviews");
    }
  }
  await audit({ actor_id: uid, action: "open_claims_set", resource_type: "paper", resource_id: paperId, old_value: { open_claims: paper.open_claims }, new_value: { open_claims: mode } });
}

async function pendingRequest(assignmentId: string) {
  const { data: a } = await db.from("review_assignments").select("id, paper_id, reviewer_id, status, round").eq("id", assignmentId).single();
  if (!a) throw new Error("Not found");
  if (a.status !== "REQUESTED") throw new Error("This request has already been answered");
  return a;
}

export async function approveReviewRequest(assignmentId: string, uid: string) {
  const a = await pendingRequest(assignmentId);
  const paper = await requireHandlingEditor(a.paper_id, uid);
  if (!["REVIEWER_ASSIGNMENT", "PEER_REVIEW"].includes(paper.status)) throw new Error("The paper is no longer waiting for reviewers");
  if (a.round !== paper.review_round) throw new Error("This request belongs to an earlier round");
  if (await isConflicted(a.paper_id, a.reviewer_id, paper.owner_id)) throw new Error("A reviewer cannot review a paper they submitted or authored");
  const s = await getSettings();
  const { count } = await db.from("review_assignments").select("id", { count: "exact", head: true }).eq("paper_id", a.paper_id).eq("round", paper.review_round).in("status", LIVE_REVIEW);
  if ((count ?? 0) >= s.reviews_required) throw new Error("All places on this paper are already taken");
  const now = new Date().toISOString();
  const due = new Date(Date.now() + s.review_days * DAY).toISOString();
  const upd = await db.from("review_assignments").update({ status: "ACCEPTED", assigned_by: uid, responded_at: now, due_at: due }).eq("id", assignmentId).eq("status", "REQUESTED").select("id");
  if (upd.error || !upd.data?.length) throw new Error("Could not approve the request");
  if (paper.status === "REVIEWER_ASSIGNMENT") await transition(a.paper_id, "PEER_REVIEW", uid, "USER", "editor approved a reviewer request");
  await notify(a.reviewer_id, "review_request_approved", "Review approved", `You can now review “${paper.title}”. Please finish by ${due.slice(0, 10)}.`, "/reviews");
  await audit({ actor_id: uid, action: "review_request_approved", resource_type: "paper", resource_id: a.paper_id, metadata: { assignment_id: assignmentId } });
}

export async function declineReviewRequest(assignmentId: string, uid: string) {
  const a = await pendingRequest(assignmentId);
  const paper = await requireHandlingEditor(a.paper_id, uid);
  const upd = await db.from("review_assignments").update({ status: "DECLINED" }).eq("id", assignmentId).eq("status", "REQUESTED").select("id");
  if (upd.error || !upd.data?.length) throw new Error("Could not decline the request");
  await notify(a.reviewer_id, "review_request_declined", "Review request declined", `The editor did not take up your request to review “${paper.title}”.`, "/reviews");
  await audit({ actor_id: uid, action: "review_request_declined", resource_type: "paper", resource_id: a.paper_id, metadata: { assignment_id: assignmentId } });
}
