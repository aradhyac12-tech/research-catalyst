import { randomUUID } from "node:crypto";
import { db, dbx, audit, requireRole, ADMINS } from "./core.server";
import { ADMIN_EMAIL_SYSTEM, LENGTH_SPEC, adminEmailProblem, buildDraftPrompt, cleanName, fallbackDraft, maskEmail, parseDraft, parseRecipients, renderAdminEmail, type Length, type Tone } from "@/lib/domain/admin-email";
import { isEmail } from "@/lib/domain/gmail-mime";

const sent = new Map<string, number[]>();
/** 20 sends per hour per administrator. (Per server instance; it limits a slip or a stolen session, not a determined attacker.) */
function allowed(uid: string, n = 1) {
  const now = Date.now();
  const list = (sent.get(uid) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length + n > 20) return false;
  for (let k = 0; k < n; k++) list.push(now);
  sent.set(uid, list);
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

/** The AI writes a draft from the administrator's notes. It sees the first name only: no e-mail address, no payment or manuscript data. Nothing is sent.
 *  It never leaves the administrator stuck: when the AI is not configured, slow or down, a plain draft built from the same notes comes back, marked as such. */
export async function draftEmail(uid: string, i: { userId?: string | undefined; name?: string | undefined; instructions: string; action?: string | undefined; tone: Tone; length: Length }) {
  await requireRole(uid, ADMINS);
  const fullName = i.userId ? (await recipient(i.userId)).name : cleanName(i.name ?? "");
  const first = fullName.split(/\s+/)[0] ?? "";
  const plain = () => ({ ...fallbackDraft({ firstName: first, instructions: i.instructions, length: i.length, action: i.action }), source: "template" as const });
  const { askAiHedged, aiAvailable } = await import("./suggest.server");
  let draft: { subject: string; body: string } | null = null;
  if (aiAvailable()) draft = await askAiHedged(ADMIN_EMAIL_SYSTEM, buildDraftPrompt({ firstName: first, instructions: i.instructions, tone: i.tone, length: i.length, action: i.action }), LENGTH_SPEC[i.length].maxOut, parseDraft);
  await audit({ actor_id: uid, action: "admin_email_drafted", resource_type: i.userId ? "user" : "external_email", resource_id: i.userId ?? null, metadata: { tone: i.tone, length: i.length, source: draft ? "ai" : "template" } });
  return draft ? { ...draft, source: "ai" as const } : plain();
}

type Target = { userId: string | null; to: string; name: string };

async function targets(i: { userId?: string | undefined; emails?: string[] | undefined }): Promise<Target[]> {
  if (i.userId) {
    const r = await recipient(i.userId);
    if (!r.to) throw new Error("This user has no valid e-mail address on file");
    return [{ userId: i.userId, to: r.to, name: r.name }];
  }
  const parsed = parseRecipients((i.emails ?? []).join(" "));
  if (parsed.invalid.length) throw new Error(`Not a valid e-mail address: ${parsed.invalid.slice(0, 3).join(", ")}`);
  if (parsed.tooMany) throw new Error("Too many addresses in one send. Send them in groups of ten or fewer.");
  if (parsed.valid.length === 0) throw new Error("Enter at least one e-mail address");
  // An address that belongs to a registered person is treated as that person (their message is linked to their account).
  const out: Target[] = [];
  for (const addr of parsed.valid) {
    const esc = addr.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data } = await db.from("profiles").select("id").ilike("email", esc).limit(1).maybeSingle();
    out.push({ userId: (data?.id as string | undefined) ?? null, to: addr, name: "" });
  }
  return out;
}

export async function sendEmail(uid: string, i: { userId?: string | undefined; emails?: string[] | undefined; subject: string; body: string; draftId?: string | undefined }) {
  await requireRole(uid, ADMINS);
  if (!!i.userId === !!(i.emails && i.emails.length)) throw new Error("Choose a registered user or enter e-mail addresses");
  const problem = adminEmailProblem(i.subject, i.body);
  if (problem) throw new Error(problem);
  const list = await targets(i);
  if (!allowed(uid, list.length)) throw new Error("You have sent many e-mails in the last hour. Please wait a little before sending more.");
  const { queueAdminEmail, mailReplyable, mailBrand } = await import("./mail.server");
  const base = i.draftId ?? randomUUID(); // the same draft id can never be sent twice to the same address
  const results: Array<{ to: string; status: "SENT" | "QUEUED" | "FAILED"; error?: string }> = [];
  for (const t of list) {
    try {
      const mail = renderAdminEmail({ subject: i.subject, body: i.body, brand: mailBrand(), replyable: mailReplyable(), audience: t.userId ? "user" : "external" });
      const res = await queueAdminEmail({ userId: t.userId, to: t.to, subject: mail.subject, text: mail.text, html: mail.html, key: list.length === 1 && i.userId ? base : `${base}:${t.to}` });
      if (res.status === "NOT_CONFIGURED") throw new Error("E-mail sending is not configured (the Gmail settings are missing), so nothing was sent.");
      await audit({ actor_id: uid, action: "admin_email_sent", resource_type: t.userId ? "user" : "external_email", resource_id: t.userId, metadata: { subject: i.subject.trim().slice(0, 150), delivery: res.status, ...(t.userId ? {} : { to: maskEmail(t.to) }) } });
      results.push({ to: t.to, status: res.status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send";
      if (list.length === 1) throw e instanceof Error ? e : new Error(msg);
      results.push({ to: t.to, status: "FAILED", error: msg });
    }
  }
  const sentN = results.filter((r) => r.status === "SENT").length, queuedN = results.filter((r) => r.status === "QUEUED").length;
  return { status: (sentN === results.length ? "SENT" : "QUEUED") as "SENT" | "QUEUED", sent: sentN, queued: queuedN, failed: results.filter((r) => r.status === "FAILED").length, results };
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
