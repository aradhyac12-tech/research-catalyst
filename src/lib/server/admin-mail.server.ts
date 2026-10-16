import { randomUUID } from "node:crypto";
import { db, dbx, audit, requireRole, ADMINS } from "./core.server";
import { ADMIN_EMAIL_SYSTEM, adminEmailProblem, buildDraftPrompt, parseDraft, renderAdminEmail } from "@/lib/domain/admin-email";
import { isEmail } from "@/lib/domain/gmail-mime";

const sent = new Map<string, number[]>();
/** 20 sends per hour per administrator. (Per server instance; it limits a slip or a stolen session, not a determined attacker.) */
function allowed(uid: string) {
  const now = Date.now();
  const list = (sent.get(uid) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= 20) return false;
  list.push(now); sent.set(uid, list);
  return true;
}

async function recipient(userId: string) {
  const { data } = await db.from("profiles").select("id, email, display_name").eq("id", userId).maybeSingle();
  if (!data) throw new Error("No such user");
  let to = (data.email ?? "").trim();
  if (!isEmail(to)) {
    const au = await db.auth.admin.getUserById(userId);
    to = (au.data?.user?.email ?? "").trim();
  }
  return { to: isEmail(to) ? to : null, name: (data.display_name ?? "").trim() };
}

/** The AI writes a draft from the administrator's instructions. It sees the first name only: no e-mail address, no payment or manuscript data. Nothing is sent. */
export async function draftEmail(uid: string, i: { userId: string; instructions: string; tone: "friendly" | "formal" | "firm" }) {
  await requireRole(uid, ADMINS);
  const r = await recipient(i.userId);
  const { askAiJson, aiAvailable } = await import("./suggest.server");
  if (!aiAvailable()) throw new Error("The AI writer is not available right now (no AI key is configured). Write the message yourself.");
  const first = r.name.split(/\s+/)[0] ?? "";
  const raw = await askAiJson(ADMIN_EMAIL_SYSTEM, buildDraftPrompt({ firstName: first, instructions: i.instructions, tone: i.tone }), 1200);
  const draft = raw ? parseDraft(raw) : null;
  if (!draft) throw new Error("The AI did not return a usable draft. Try again, or write the message yourself.");
  await audit({ actor_id: uid, action: "admin_email_drafted", resource_type: "user", resource_id: i.userId, metadata: { tone: i.tone } });
  return { ...draft, hasAddress: !!r.to };
}

export async function sendEmail(uid: string, i: { userId: string; subject: string; body: string; draftId?: string | undefined }) {
  await requireRole(uid, ADMINS);
  const problem = adminEmailProblem(i.subject, i.body);
  if (problem) throw new Error(problem);
  if (!allowed(uid)) throw new Error("You have sent many e-mails in the last hour. Please wait a little before sending more.");
  const r = await recipient(i.userId);
  if (!r.to) throw new Error("This user has no valid e-mail address on file");
  const { queueAdminEmail, mailReplyable, mailBrand } = await import("./mail.server");
  const mail = renderAdminEmail({ subject: i.subject, body: i.body, brand: mailBrand(), replyable: mailReplyable() });
  const key = i.draftId ?? randomUUID(); // the same draft id can never be sent twice
  const res = await queueAdminEmail({ userId: i.userId, to: r.to, subject: mail.subject, text: mail.text, html: mail.html, key });
  if (res.status === "NOT_CONFIGURED") throw new Error("E-mail sending is not configured (the Gmail settings are missing), so nothing was sent.");
  await audit({ actor_id: uid, action: "admin_email_sent", resource_type: "user", resource_id: i.userId, metadata: { subject: i.subject.trim().slice(0, 150), delivery: res.status } });
  return { status: res.status };
}

export async function emailHistory(uid: string, userId?: string) {
  await requireRole(uid, ADMINS);
  let q = dbx.from("email_outbox").select("id, user_id, to_email, subject, status, created_at, sent_at, last_error").eq("kind", "admin_message").order("created_at", { ascending: false }).limit(15);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  return ((data ?? []) as Array<{ id: string; to_email: string; subject: string; status: string; created_at: string; sent_at: string | null; last_error: string | null }>).map((r) => ({ id: r.id, to: r.to_email, subject: r.subject, status: r.status, created_at: r.created_at, sent_at: r.sent_at, failed: r.status === "DEAD" ? (r.last_error ?? "Could not be delivered") : null }));
}

const PAGE = 20;
/** People an administrator can write to, listed without needing a search. "recent" keeps only those who signed in within the last 7 days, newest first.
 *  The auth service gives the last sign-in time; it does not track who is online this second, so "recent" is the closest honest meaning of "logged in". */
export async function listRecipients(uid: string, f: { q?: string | undefined; page: number; recent: boolean }) {
  await requireRole(uid, ADMINS);
  const last = new Map<string, string>();
  for (let page = 1; page <= 3; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data?.users ?? []) if (u.last_sign_in_at) last.set(u.id, u.last_sign_in_at);
    if ((data?.users ?? []).length < 1000) break;
  }
  const q = (f.q ?? "").replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
  let ids: string[] | null = null; let total = 0;
  if (f.recent) {
    const since = Date.now() - 7 * 86_400_000;
    const all = Array.from(last).filter(([, t]) => new Date(t).getTime() >= since).sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
    if (q) {
      const { data } = all.length ? await db.from("profiles").select("id").in("id", all.slice(0, 1000)).or(`email.ilike.%${q}%,display_name.ilike.%${q}%`) : { data: [] as Array<{ id: string }> };
      const keep = new Set((data ?? []).map((r) => r.id)); ids = all.filter((id) => keep.has(id));
    } else ids = all;
    total = ids.length; ids = ids.slice((f.page - 1) * PAGE, f.page * PAGE);
  }
  let query = db.from("profiles").select("id, email, display_name, created_at", { count: "exact" });
  if (ids) query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  else {
    query = query.order("created_at", { ascending: false }).range((f.page - 1) * PAGE, f.page * PAGE - 1);
    if (q) query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%`);
  }
  const { data, count, error } = await query;
  if (error) throw new Error("Could not load users");
  const rows = (data ?? []).map((u) => ({ id: u.id, email: u.email ?? "(no email)", name: (u.display_name as string | null) || null, lastSignIn: last.get(u.id) ?? null }));
  if (ids) rows.sort((a, b) => ids!.indexOf(a.id) - ids!.indexOf(b.id));
  return { rows, total: ids ? total : count ?? 0, page: f.page, pageSize: PAGE };
}
