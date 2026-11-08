import { db, dbx, getRoles, requirePermission, requireRole, ADMINS, FOUNDERS, assertFounderNotOnHold, audit } from "./core.server";
import { hasPermission } from "@/lib/domain/permissions";

const PAGE = 25;
const SHOWN_ROLES = ["editor", "reviewer", "founder", "admin", "super_admin"];

/** Users and their roles. Administrators only: who holds which role is not shown to anyone else. */
export async function listUsers(uid: string, f: { q?: string | undefined; page: number }) {
  // One read of the caller's roles serves both checks.
  const mine = await getRoles(uid);
  if (!hasPermission(mine, "USERS_READ")) throw new Error("Forbidden: insufficient permission");
  if (!mine.some((r) => ADMINS.includes(r))) throw new Error("Forbidden: only administrators can see assigned roles");
  const q = (f.q ?? "").replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
  let query = db.from("profiles").select("id, email, display_name, created_at", { count: "exact" }).order("created_at", { ascending: false }).range((f.page - 1) * PAGE, f.page * PAGE - 1);
  if (q) query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error("Could not load users");
  const ids = (data ?? []).map((u) => u.id);
  const { data: roles } = ids.length ? await db.from("user_roles").select("user_id, role").in("user_id", ids) : { data: [] as Array<{ user_id: string; role: string }> };
  const blocked = await (await import("./maintenance.server")).blockedIds(ids);
  const { data: holds, error: holdsErr } = ids.length ? await dbx.from("founder_dues_holds").select("user_id, note, set_at").in("user_id", ids) : { data: [], error: null };
  // Never hide a failure here: an unreadable dues table used to show as "no dues" for everyone.
  if (holdsErr) throw new Error("Could not load dues (is migration 0052_founder_dues_holds applied?)");
  const held = new Map(((holds ?? []) as Array<{ user_id: string; note: string | null; set_at: string | null }>).map((h) => [h.user_id, h]));
  const { data: defs, error: defErr } = ids.length ? await dbx.from("payment_deferrals").select("user_id, amount_minor, currency, due_at").in("user_id", ids).eq("status", "DUE") : { data: [], error: null };
  if (defErr) throw new Error("Could not load dues");
  const now = Date.now();
  const dues = new Map<string, Array<{ amount_minor: number; currency: string; due_at: string; overdue: boolean }>>();
  for (const d of (defs ?? []) as Array<{ user_id: string; amount_minor: number; currency: string; due_at: string }>) dues.set(d.user_id, [...(dues.get(d.user_id) ?? []), { amount_minor: d.amount_minor, currency: d.currency, due_at: d.due_at, overdue: Date.parse(d.due_at) < now }]);
  return {
    rows: (data ?? []).map((u) => ({ id: u.id, email: u.email ?? "(no email)", name: u.display_name || null, created_at: u.created_at, blocked: blocked.has(u.id), dueHold: held.has(u.id), dues: dues.get(u.id) ?? [], dueNote: held.get(u.id)?.note ?? null, dueSince: held.get(u.id)?.set_at ?? null, roles: (roles ?? []).filter((r) => r.user_id === u.id && SHOWN_ROLES.includes(r.role)).map((r) => r.role as string).sort() })),
    total: count ?? 0, page: f.page, pageSize: PAGE,
    // The screen only offers what the caller may actually do; the server re-checks on every change.
    canGrantFounder: mine.some((r) => ADMINS.includes(r)), selfId: uid,
  };
}

/** Read-only business summary for founders and administrators. Each block is returned only if the caller holds the matching
 *  permission (people: USERS_READ, money and transactions: FINANCE_READ), so the screen never has anything empty to draw. */
export async function founderSummary(uid: string) {
  const roles = await getRoles(uid);
  const canUsers = hasPermission(roles, "USERS_READ");
  const canFinance = hasPermission(roles, "FINANCE_READ");
  if (!canUsers && !canFinance) throw new Error("Forbidden: insufficient permission");
  await assertFounderNotOnHold(uid, roles);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const peoplePromise = canUsers ? (async () => {
    const [users, recent] = await Promise.all([
      db.from("profiles").select("id", { count: "exact", head: true }),
      db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
    ]);
    if (users.error) throw new Error("Could not load users");
    return { users: users.count ?? 0, newUsers30d: recent.count ?? 0 };
  })() : null;
  const moneyPromise = canFinance ? (async () => {
    const pays = await db.from("payments").select("status, currency, amount_minor", { count: "exact" }).eq("is_test", false).order("created_at", { ascending: false }).limit(10000);
    if (pays.error) throw new Error("Could not load payments");
    const byCur = new Map<string, { paid: number; paidCount: number; refunded: number; refundedCount: number }>();
    const counts: Record<string, number> = {};
    for (const p of pays.data ?? []) {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
      const c = byCur.get(p.currency) ?? { paid: 0, paidCount: 0, refunded: 0, refundedCount: 0 };
      if (p.status === "PAID") { c.paid += p.amount_minor; c.paidCount++; }
      if (p.status === "REFUNDED") { c.refunded += p.amount_minor; c.refundedCount++; }
      byCur.set(p.currency, c);
    }
    return {
      currencies: Array.from(byCur, ([currency, v]) => ({ currency, ...v })).sort((a, b) => b.paid - a.paid),
      statusCounts: counts, transactions: pays.count ?? 0, truncated: (pays.count ?? 0) > (pays.data ?? []).length,
    };
  })() : null;
  const [people, money] = await Promise.all([peoplePromise, moneyPromise]);
  return { people, money };
}

export async function founderTransactions(uid: string, f: { status?: string | undefined; page: number }) {
  await requirePermission(uid, "FINANCE_READ");
  let q = db.from("payments").select("order_id, user_id, amount_minor, currency, provider, provider_transaction_id, status, created_at, completed_at, refunded_at", { count: "exact" }).order("created_at", { ascending: false }).range((f.page - 1) * PAGE, f.page * PAGE - 1);
  if (f.status && ["PENDING", "PROCESSING", "PAID", "FAILED", "REFUNDED", "CANCELLED"].includes(f.status)) q = q.eq("status", f.status as "PAID");
  const { data, count, error } = await q;
  if (error) throw new Error("Could not load transactions");
  const ids = Array.from(new Set((data ?? []).map((p) => p.user_id)));
  const { data: prof } = ids.length ? await db.from("profiles").select("id, email").in("id", ids) : { data: [] as Array<{ id: string; email: string | null }> };
  const em = new Map((prof ?? []).map((p) => [p.id, p.email]));
  return { rows: (data ?? []).map(({ user_id, ...p }) => ({ ...p, email: em.get(user_id) ?? "(unknown)" })), total: count ?? 0, page: f.page, pageSize: PAGE };
}



/** Only the payments an administrator chose to share, with the amount the administrator wants shown. Founders and administrators.
 *  Never returns the real amount, provider ids or the payer's email: just date, reference, status and the shown amount.
 * */
export async function founderSharedPayments(uid: string, f: { page: number }) {
  const roles = await requireRole(uid, [...FOUNDERS, ...ADMINS]);
  await assertFounderNotOnHold(uid, roles);
  const { data: shares, error } = await dbx.from("founder_shared_payments").select("payment_id, shown_amount_minor, shared_at").order("shared_at", { ascending: false }).limit(2000);
  if (error) throw new Error("Could not load shared payments");
  const list = (shares ?? []) as Array<{ payment_id: string; shown_amount_minor: number | null; shared_at: string }>;
  if (!list.length) return { rows: [], totals: [], total: 0, page: f.page, pageSize: PAGE };
  const { data: pays } = await db.from("payments").select("id, order_id, amount_minor, currency, status, created_at, completed_at").in("id", list.map((x) => x.payment_id));
  const by = new Map((pays ?? []).map((p) => [p.id, p]));
  const all = list.flatMap((x) => {
    const p = by.get(x.payment_id);
    if (!p) return [];
    const shown = x.shown_amount_minor ?? p.amount_minor;
    return [{ order_id: p.order_id, status: p.status, currency: p.currency, amount_minor: shown, created_at: p.created_at, completed_at: p.completed_at, shared_at: x.shared_at }];
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const tot = new Map<string, { paid: number; paidCount: number }>();
  for (const r of all) if (r.status === "PAID") { const t = tot.get(r.currency) ?? { paid: 0, paidCount: 0 }; t.paid += r.amount_minor; t.paidCount++; tot.set(r.currency, t); }
  return { rows: all.slice((f.page - 1) * PAGE, f.page * PAGE), totals: Array.from(tot, ([currency, v]) => ({ currency, ...v })), total: all.length, page: f.page, pageSize: PAGE };
}


/** Put a founder's dues on hold, or lift it. Administrators only; only someone who holds the founder role can be held. */
export async function setFounderDues(uid: string, target: string, due: boolean, note?: string) {
  await requireRole(uid, ADMINS);
  const { data: r } = await db.from("user_roles").select("role").eq("user_id", target).eq("role", "founder").maybeSingle();
  if (!r) throw new Error("That person is not a founder");
  if (due) {
    const { error } = await dbx.from("founder_dues_holds").upsert({ user_id: target, note: note?.trim() || null, set_by: uid, set_at: new Date().toISOString() });
    if (error) throw new Error("Could not place the hold");
  } else {
    const { error } = await dbx.from("founder_dues_holds").delete().eq("user_id", target);
    if (error) throw new Error("Could not lift the hold");
  }
  await audit({ actor_id: uid, action: due ? "founder_dues_hold_set" : "founder_dues_hold_lifted", resource_type: "user", resource_id: target, metadata: due ? { note: note?.trim() || null } : {} });
  return { ok: true as const };
}

/** Whether this founder is blocked for unpaid dues, and the note the administrator left. Administrators and non-founders are never on hold. */
export async function founderHold(uid: string) {
  const st = await (await import("./core.server")).founderHoldState(uid, await getRoles(uid));
  return st.onHold ? { onHold: true as const, note: st.note } : { onHold: false as const };
}

/** Names only, for founders: no email, no roles, no ids. Someone who has not saved a name shows as "Unnamed user". Founders and administrators. */
export async function founderUserNames(uid: string, f: { page: number }) {
  const roles = await requireRole(uid, [...FOUNDERS, ...ADMINS]);
  await assertFounderNotOnHold(uid, roles);
  const { data, count, error } = await db.from("profiles").select("display_name", { count: "exact" }).order("created_at", { ascending: false }).range((f.page - 1) * PAGE, f.page * PAGE - 1);
  if (error) throw new Error("Could not load users");
  return { names: (data ?? []).map((u) => (u.display_name ?? "").trim() || "Unnamed user"), total: count ?? 0, page: f.page, pageSize: PAGE };
}


/** Everyone who currently owes something, across all pages: administrator holds on founders (with their note) and pay-later deferrals
 *  still DUE for any user (with amount and due date; "overdue" once the date has passed). Administrators only. */
export async function listDuesHolds(uid: string) {
  await requireRole(uid, ADMINS);
  const [h, d] = await Promise.all([
    dbx.from("founder_dues_holds").select("user_id, note, set_at").order("set_at", { ascending: false }).limit(500),
    dbx.from("payment_deferrals").select("id, user_id, email, name, amount_minor, currency, due_at, note").eq("status", "DUE").order("due_at", { ascending: true }).limit(500),
  ]);
  if (h.error || d.error) throw new Error("Could not load dues");
  const holds = (h.data ?? []) as Array<{ user_id: string; note: string | null; set_at: string | null }>;
  const defs = (d.data ?? []) as Array<{ id: string; user_id: string; email: string | null; name: string | null; amount_minor: number; currency: string; due_at: string; note: string | null }>;
  const ids = Array.from(new Set(holds.map((x) => x.user_id)));
  const { data: prof } = ids.length ? await db.from("profiles").select("id, email, display_name").in("id", ids) : { data: [] as Array<{ id: string; email: string | null; display_name: string | null }> };
  const by = new Map((prof ?? []).map((p) => [p.id, p]));
  const now = Date.now();
  type Row = { key: string; id: string; deferralId: string | null; name: string | null; email: string; kind: "hold" | "deferral"; note: string | null; amount_minor: number | null; currency: string | null; due_at: string | null; overdue: boolean; since: string | null };
  const rows: Row[] = [
    ...defs.map((x): Row => ({ key: `d:${x.id}`, id: x.user_id, deferralId: x.id, name: x.name, email: x.email ?? "(no email)", kind: "deferral", note: x.note, amount_minor: x.amount_minor, currency: x.currency, due_at: x.due_at, overdue: Date.parse(x.due_at) < now, since: null })),
    ...holds.map((x): Row => ({ key: `h:${x.user_id}`, id: x.user_id, deferralId: null, name: by.get(x.user_id)?.display_name || null, email: by.get(x.user_id)?.email ?? "(no email)", kind: "hold", note: x.note, amount_minor: null, currency: null, due_at: null, overdue: false, since: x.set_at })),
  ];
  return { rows };
}


/** Administrator clears a pay-later due: PAID (money received outside checkout) or CANCELLED (written off). Only a DUE row changes. */
export async function resolveDeferral(uid: string, deferralId: string, outcome: "PAID" | "CANCELLED") {
  await requireRole(uid, ADMINS);
  const now = new Date().toISOString();
  const patch = outcome === "PAID" ? { status: "PAID", paid_at: now } : { status: "CANCELLED", cancelled_by: uid, cancelled_at: now };
  const { data, error } = await dbx.from("payment_deferrals").update(patch).eq("id", deferralId).eq("status", "DUE").select("id, user_id");
  if (error) throw new Error("Could not clear the due");
  if (!data?.length) throw new Error("This due is already cleared");
  await audit({ actor_id: uid, action: outcome === "PAID" ? "dues_cleared_by_admin" : "dues_cancelled_by_admin", resource_type: "user", resource_id: (data[0] as { user_id: string }).user_id, metadata: { deferral_id: deferralId } });
  return { ok: true as const };
}
