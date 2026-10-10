import { db, audit, notify, transition, requireRole, ADMINS, STAFF } from "./core.server";
import { classifyReference, type LookupOutcome } from "@/lib/domain/references";

export const NOTICE_KINDS = ["ERRATUM", "ADDENDUM", "EXPRESSION_OF_CONCERN", "CORRECTION", "RETRACTION", "WITHDRAWAL"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

async function isConflicted(paperId: string, uid: string) {
  const { data: p } = await db.from("papers").select("owner_id").eq("id", paperId).single();
  if (p?.owner_id === uid) return true;
  const { data } = await db.from("paper_authors").select("id").eq("paper_id", paperId).eq("user_id", uid).limit(1);
  return (data?.length ?? 0) > 0;
}

// ---------------- reference validation ----------------
async function lookupDoi(doi: string): Promise<LookupOutcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const mailto = process.env["CROSSREF_MAILTO"];
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      signal: ctl.signal, headers: { Accept: "application/json", "User-Agent": `Paperly/1.0${mailto ? ` (mailto:${mailto})` : ""}` },
    });
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "unavailable" };
    const j = (await res.json()) as { message?: { title?: string[] } };
    return { kind: "found", title: j.message?.title?.[0] ?? null };
  } catch {
    return { kind: "unavailable" };
  } finally { clearTimeout(timer); }
}

/** Owner (before publication) or staff may validate. Published lists are frozen by a database trigger. */
export async function validateReferences(paperId: string, uid: string) {
  const { data: paper } = await db.from("papers").select("owner_id, status").eq("id", paperId).single();
  if (!paper) throw new Error("Not found");
  if (paper.owner_id !== uid) await requireRole(uid, STAFF);
  if (["PUBLISHED", "CORRECTED", "RETRACTED"].includes(paper.status)) throw new Error("The reference list of a published record is frozen. Issue a correction instead.");
  const { data: refs } = await db.from("paper_references").select("id, raw_text, doi").eq("paper_id", paperId).order("position").limit(200);
  const list = refs ?? [];
  const results: Array<{ id: string; status: string; note: string; title: string | null }> = [];
  for (let i = 0; i < list.length; i += 4) {
    const batch = list.slice(i, i + 4);
    const out = await Promise.all(batch.map(async (r) => {
      const lookup = r.doi ? await lookupDoi(r.doi) : null;
      const c = classifyReference(r.raw_text, r.doi, lookup);
      return { id: r.id, status: c.status, note: c.note, title: lookup?.kind === "found" ? lookup.title : null };
    }));
    results.push(...out);
  }
  const now = new Date().toISOString();
  for (const r of results) {
    await db.from("paper_references").update({ validation_status: r.status as never, validation_note: r.note, matched_title: r.title, validated_at: now }).eq("id", r.id);
  }
  const summary = results.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  await audit({ actor_id: uid, action: "references_validated", resource_type: "paper", resource_id: paperId, metadata: summary });
  return { total: results.length, summary };
}

// ---------------- post-publication notices ----------------
export async function issueNotice(input: { paperId: string; uid: string; kind: NoticeKind; notice: string; reason: string; newTitle?: string; newAbstract?: string }) {
  await requireRole(input.uid, ADMINS);
  if (await isConflicted(input.paperId, input.uid)) throw new Error("Conflict of interest: you cannot issue a notice on a record you submitted or authored");
  const { data: p } = await db.from("papers").select("id, status, owner_id, paperly_id, title").eq("id", input.paperId).single();
  if (!p) throw new Error("Not found");
  if (!["PUBLISHED", "CORRECTED"].includes(p.status)) throw new Error("Notices apply to published records only (retracted records cannot be amended)");
  if (input.notice.trim().length < 20) throw new Error("The public notice needs at least 20 characters");
  if (input.reason.trim().length < 10) throw new Error("A reason of at least 10 characters is required");
  if ((input.newTitle || input.newAbstract) && input.kind !== "CORRECTION") throw new Error("Only a CORRECTION may change the title or abstract");

  // Order matters: the permanent notice is written first, then the status/content change. A failure after the notice leaves a visible notice, never a silent change.
  const { error } = await db.from("corrections").insert({ paper_id: p.id, kind: input.kind as never, notice: input.notice.trim(), reason: input.reason.trim(), issued_by: input.uid });
  if (error) throw new Error("Could not record the notice");

  if (input.kind === "CORRECTION") {
    if (input.newTitle || input.newAbstract) {
      const { error: e } = await db.rpc("apply_published_correction", { _paper_id: p.id, _new_version_id: null as never, _title: (input.newTitle?.trim() || null) as never, _abstract: (input.newAbstract?.trim() || null) as never });
      if (e) throw new Error(e.message);
    }
    await transition(p.id, "CORRECTED", input.uid, "USER", `correction notice: ${input.reason.trim()}`);
  } else if (input.kind === "RETRACTION" || input.kind === "WITHDRAWAL") {
    await transition(p.id, "RETRACTED", input.uid, "USER", `${input.kind.toLowerCase()}: ${input.reason.trim()}`);
    // The permanent record and its certificates stay; certificates are marked so verification does not imply the work stands.
    const { data: certs } = await db.from("certificates").select("id, status").eq("paper_id", p.id);
    for (const c of certs ?? []) {
      if (c.status === "VALID") {
        await db.from("certificates").update({ status: "RETRACTED" as never, status_reason: `Record ${input.kind === "WITHDRAWAL" ? "withdrawn" : "retracted"}: ${input.reason.trim()}`.slice(0, 500) }).eq("id", c.id);
        await db.from("certificate_events").insert({ certificate_id: c.id, event: "RETRACTED", reason: `Record ${input.kind.toLowerCase()}`, actor_id: input.uid });
      }
    }
  }
  await audit({ actor_id: input.uid, action: `notice_${input.kind.toLowerCase()}`, resource_type: "paper", resource_id: p.id, metadata: { reason: input.reason.trim() } });
  await notify(p.owner_id, "notice", "A notice was issued on your record", `${p.paperly_id}: ${input.kind.replace(/_/g, " ").toLowerCase()}.`, `/article/${p.paperly_id}`);
  return { ok: true };
}
