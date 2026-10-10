import { db, getRoles, requirePermission, ADMINS } from "./core.server";

const PAGE = 25;
const SHOWN_ROLES = ["editor", "reviewer", "founder", "admin", "super_admin"];

/** Users and their roles. Allowed for founders and administrators; returns only what the roles screen needs. */
export async function listUsers(uid: string, f: { q?: string | undefined; page: number }) {
  await requirePermission(uid, "USERS_READ");
  const q = (f.q ?? "").replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
  let query = db.from("profiles").select("id, email, display_name, created_at", { count: "exact" }).order("created_at", { ascending: false }).range((f.page - 1) * PAGE, f.page * PAGE - 1);
  if (q) query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error("Could not load users");
  const ids = (data ?? []).map((u) => u.id);
  const { data: roles } = ids.length ? await db.from("user_roles").select("user_id, role").in("user_id", ids) : { data: [] as Array<{ user_id: string; role: string }> };
  const mine = await getRoles(uid);
  return {
    rows: (data ?? []).map((u) => ({ id: u.id, email: u.email ?? "(no email)", name: u.display_name || null, created_at: u.created_at, roles: (roles ?? []).filter((r) => r.user_id === u.id && SHOWN_ROLES.includes(r.role)).map((r) => r.role as string).sort() })),
    total: count ?? 0, page: f.page, pageSize: PAGE,
    // The screen only offers what the caller may actually do; the server re-checks on every change.
    canGrantFounder: mine.some((r) => ADMINS.includes(r)), selfId: uid,
  };
}

/** Read-only business summary for founders and administrators: people and money. */
export async function founderSummary(uid: string) {
  await requirePermission(uid, "FINANCE_READ");
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [users, recent, pays] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("payments").select("status, currency, amount_minor", { count: "exact" }).order("created_at", { ascending: false }).limit(10000),
  ]);
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
    users: users.count ?? 0, newUsers30d: recent.count ?? 0,
    currencies: Array.from(byCur, ([currency, v]) => ({ currency, ...v, net: v.paid })).sort((a, b) => b.paid - a.paid),
    statusCounts: counts, transactions: pays.count ?? 0, truncated: (pays.count ?? 0) > (pays.data ?? []).length,
  };
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

