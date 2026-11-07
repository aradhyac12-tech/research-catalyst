import { parseKeywords } from "@/lib/domain/keywords";
import { db, dbx, getRoles, requireRole, audit, notify, STAFF, ADMINS } from "./core.server";

export const EDIT_FIELDS = ["title", "abstract", "keywords"] as const;
export type EditField = (typeof EDIT_FIELDS)[number];
const EDITABLE_STATUSES = ["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"];

async function loadPaper(paperId: string) {
  const { data } = await db.from("papers").select("id, title, abstract, keywords, status, owner_id, handling_editor_id, review_model, current_version_id, publication_type").eq("id", paperId).maybeSingle();
  if (!data) throw new Error("Not found");
  return data;
}

/** Same rule the editorial queue uses: staff only, never on their own work, and not on another editor's paper unless an administrator. */
async function requireEditorFor(paperId: string, uid: string) {
  const roles = await requireRole(uid, STAFF);
  const paper = await loadPaper(paperId);
  if (paper.owner_id === uid) throw new Error("Conflict of interest: you cannot handle a manuscript you submitted");
  const { count } = await db.from("paper_authors").select("id", { count: "exact", head: true }).eq("paper_id", paperId).eq("user_id", uid);
  if ((count ?? 0) > 0) throw new Error("Conflict of interest: you cannot handle a manuscript you authored");
  const isAdmin = roles.some((r) => ADMINS.includes(r));
  if (paper.handling_editor_id && paper.handling_editor_id !== uid && !isAdmin) throw new Error("This manuscript is assigned to another editor");
  return paper;
}

const kw = (k: string[] | null) => (k ?? []).join(", ");

export async function manuscriptView(paperId: string, uid: string, assignmentId?: string) {
  const roles = await getRoles(uid);
  const paper = await loadPaper(paperId);
  let role: "editor" | "reviewer" | "author";
  let assignment: { id: string; status: string; due_at: string | null } | null = null;

  if (roles.some((r) => STAFF.includes(r))) { await requireEditorFor(paperId, uid); role = "editor"; }
  else {
    const { data: a } = await db.from("review_assignments").select("id, status, due_at").eq("paper_id", paperId).eq("reviewer_id", uid).in("status", ["ACCEPTED", "COMPLETED"]).order("assigned_at", { ascending: false }).limit(1).maybeSingle();
    if (a && (!assignmentId || a.id === assignmentId)) { role = "reviewer"; assignment = a; }
    else if (paper.owner_id === uid) role = "author";
    else throw new Error("Not found");
  }

  const { data: edits } = await dbx.from("editorial_edits").select("id, field, before_text, after_text, note, status, created_at, updated_at").eq("paper_id", paperId).eq("status", "PROPOSED").order("created_at");

  let url: string | null = null;
  if (role !== "author") {
    const { data: ver } = await db.from("paper_versions").select("storage_path, anonymized_storage_path").eq("id", paper.current_version_id!).maybeSingle();
    const anon = role === "reviewer" && (paper.review_model ?? "DOUBLE_ANONYMOUS") === "DOUBLE_ANONYMOUS";
    const path = anon ? ver?.anonymized_storage_path : ver?.storage_path;
    if (path) url = (await db.storage.from("manuscripts").createSignedUrl(path, 300)).data?.signedUrl ?? null;
  }
  // Editor identity is never exposed: in anonymous review a reviewer must not learn who handled the paper.
  return {
    role, paperStatus: paper.status, publicationType: paper.publication_type, canEdit: role === "editor" && EDITABLE_STATUSES.includes(paper.status),
    decisionReady: ["REVIEW_REQUIRED", "EDITORIAL_DECISION"].includes(paper.status),
    canDecide: role === "author" && EDITABLE_STATUSES.includes(paper.status),
    paper: { title: paper.title, abstract: paper.abstract, keywords: kw(paper.keywords) },
    edits: (edits ?? []) as Array<{ id: string; field: EditField; before_text: string; after_text: string; note: string | null; created_at: string; updated_at: string }>,
    url, assignment,
  };
}

export async function proposeEdit(paperId: string, uid: string, field: EditField, after: string, note?: string) {
  const paper = await requireEditorFor(paperId, uid);
  if (!EDITABLE_STATUSES.includes(paper.status)) throw new Error("Changes can be tracked only while the manuscript is in editorial handling or review");
  const current = field === "keywords" ? kw(paper.keywords) : (paper[field] ?? "");
  const text = after.trim();
  if (!text) throw new Error("The new text cannot be empty");
  const { data: open } = await dbx.from("editorial_edits").select("id, before_text").eq("paper_id", paperId).eq("field", field).eq("status", "PROPOSED").maybeSingle();
  const before = (open?.before_text as string | undefined) ?? current; // the original stays the original however often the proposal is revised
  if (text === before) {
    if (open) await dbx.from("editorial_edits").update({ status: "WITHDRAWN", updated_at: new Date().toISOString() }).eq("id", open.id);
    return { id: null };
  }
  const row = { after_text: text, note: note?.trim() || null, editor_id: uid, updated_at: new Date().toISOString() };
  const res = open
    ? await dbx.from("editorial_edits").update(row).eq("id", open.id).select("id").single()
    : await dbx.from("editorial_edits").insert({ ...row, paper_id: paperId, version_id: paper.current_version_id, field, before_text: before }).select("id").single();
  if (res.error) throw new Error("Could not save the tracked change");
  await audit({ actor_id: uid, action: "tracked_change_proposed", resource_type: "paper", resource_id: paperId, metadata: { field } });
  if (!open) await notify(paper.owner_id, "tracked_change_proposed", "The editor changed your manuscript", `The editor made a tracked change to your ${field}. Open your manuscript page to see what changed, then accept or reject it.`, `/manuscript/${paperId}`);
  return { id: res.data.id as string };
}

export async function withdrawEdit(editId: string, uid: string) {
  const { data: e } = await dbx.from("editorial_edits").select("id, paper_id, field").eq("id", editId).eq("status", "PROPOSED").maybeSingle();
  if (!e) throw new Error("Not found");
  await requireEditorFor(e.paper_id as string, uid);
  const { error } = await dbx.from("editorial_edits").update({ status: "WITHDRAWN", updated_at: new Date().toISOString() }).eq("id", editId);
  if (error) throw new Error("Could not withdraw the change");
  await audit({ actor_id: uid, action: "tracked_change_withdrawn", resource_type: "paper", resource_id: e.paper_id as string, metadata: { field: e.field } });
}

/** The author accepts (text is applied to the paper) or rejects (paper unchanged) one proposed change. */
export async function authorDecideEdit(editId: string, uid: string, accept: boolean) {
  const { data: e } = await dbx.from("editorial_edits").select("id, paper_id, field, before_text, after_text, editor_id").eq("id", editId).eq("status", "PROPOSED").maybeSingle();
  if (!e) throw new Error("Not found");
  const paper = await loadPaper(e.paper_id as string);
  if (paper.owner_id !== uid) throw new Error("Not found"); // never reveal another author's manuscript
  if (!EDITABLE_STATUSES.includes(paper.status)) throw new Error("Changes can be accepted or rejected only while the manuscript is in editorial handling or review");
  const field = e.field as EditField;
  const now = new Date().toISOString();
  // Claim the proposal first so a double click or a concurrent withdrawal cannot apply it twice.
  const claim = await dbx.from("editorial_edits").update({ status: accept ? "ACCEPTED" : "REJECTED", decided_by: uid, decided_at: now, updated_at: now }).eq("id", editId).eq("status", "PROPOSED").select("id");
  if (claim.error || !claim.data?.length) throw new Error("This change was already decided or withdrawn");
  if (accept) {
    const patch = field === "keywords" ? { keywords: parseKeywords(e.after_text as string) } : { [field]: e.after_text as string };
    const { error } = await db.from("papers").update({ ...patch, updated_at: now } as never).eq("id", paper.id);
    if (error) {
      await dbx.from("editorial_edits").update({ status: "PROPOSED", decided_by: null, decided_at: null }).eq("id", editId);
      throw new Error("Could not apply the change");
    }
  }
  await audit({ actor_id: uid, action: accept ? "tracked_change_accepted" : "tracked_change_rejected", resource_type: "paper", resource_id: paper.id, old_value: { [field]: e.before_text }, new_value: accept ? { [field]: e.after_text } : null, metadata: { field } });
  if (e.editor_id) await notify(e.editor_id as string, "TRACKED_CHANGE_DECIDED", accept ? "Author accepted your change" : "Author rejected your change", `The author ${accept ? "accepted" : "rejected"} your tracked change to the ${field}.`, `/manuscript/${paper.id}`);
  return { ok: true as const, accepted: accept };
}
