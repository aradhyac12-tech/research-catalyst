import { dbx } from "./core.server";

/** A started but unpaid order holds its promo place for this long, so a code with a limit cannot be over-issued while people are checking out. */
export const PROMO_HOLD_MS = 30 * 60_000;

export interface PromoUsage { used: number; held: number; byUser: Map<string, { used: number; held: number }> }

/**
 * How many times each code has really been taken. Counted from the payments themselves (paid, refunded, awaiting verification, or an
 * unpaid order started in the last 30 minutes), plus any recorded redemption, so a missed redemption row can never show a used code as unused.
 * Test payments never count.
 */
export async function promoUsage(ids: string[], now = Date.now()): Promise<Map<string, PromoUsage>> {
  const out = new Map<string, PromoUsage>();
  if (!ids.length) return out;
  for (const id of ids) out.set(id, { used: 0, held: 0, byUser: new Map() });
  const bump = (u: PromoUsage, user: string, kind: "used" | "held") => {
    u[kind]++;
    const m = u.byUser.get(user) ?? { used: 0, held: 0 };
    m[kind]++; u.byUser.set(user, m);
  };
  const [{ data: pays }, { data: reds }] = await Promise.all([
    dbx.from("payments").select("id, promo_code_id, user_id, status, created_at").in("promo_code_id", ids).eq("is_test", false).in("status", ["PAID", "REFUNDED", "PROCESSING", "PENDING"]),
    dbx.from("promo_redemptions").select("promo_id, payment_id, user_id").in("promo_id", ids),
  ]) as unknown as [{ data: Array<{ id: string; promo_code_id: string; user_id: string; status: string; created_at: string }> | null }, { data: Array<{ promo_id: string; payment_id: string; user_id: string }> | null }];
  const seen = new Set<string>();
  for (const p of pays ?? []) {
    const u = out.get(p.promo_code_id); if (!u) continue;
    if (p.status === "PAID" || p.status === "REFUNDED") { seen.add(p.id); bump(u, p.user_id, "used"); }
    else if (p.status === "PROCESSING" || now - new Date(p.created_at).getTime() < PROMO_HOLD_MS) { seen.add(p.id); bump(u, p.user_id, "held"); }
  }
  for (const r of reds ?? []) {
    const u = out.get(r.promo_id); if (!u || seen.has(r.payment_id)) continue;
    seen.add(r.payment_id); bump(u, r.user_id, "used");
  }
  return out;
}
