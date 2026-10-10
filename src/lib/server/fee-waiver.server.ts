// Paywall pause. A person with an active waiver is not charged the submission fee: screening starts without payment
// and an accepted paper goes straight to production.
// Who decides: administrators and founders can pause or resume it. An administrator is on top: a pause an administrator set
// cannot be resumed or replaced by a founder. Roles are checked here, not only on the screen.
import { db, dbx, audit, getRoles, ADMINS, FOUNDERS } from "./core.server";

interface WaiverRow { id: string; user_id: string; email: string | null; note: string | null; created_at: string; revoked_at: string | null; set_by_admin: boolean }

export async function isFeeWaived(userId: string) {
  const { data } = await dbx.from("fee_waivers").select("id").eq("user_id", userId).is("revoked_at", null).maybeSingle();
  return !!data;
}

async function actor(uid: string) {
  const roles = await getRoles(uid);
  const isAdmin = roles.some((r) => ADMINS.includes(r));
  if (!isAdmin && !roles.some((r) => FOUNDERS.includes(r))) throw new Error("Forbidden: only an administrator or a founder can do this");
  return { isAdmin };
}

export async function listWaivers(uid: string) {
  const { isAdmin } = await actor(uid);
  const { data } = await dbx.from("fee_waivers").select("id, user_id, email, note, created_at, revoked_at, set_by_admin").is("revoked_at", null).order("created_at", { ascending: false }) as { data: WaiverRow[] | null };
  return (data ?? []).map((w) => ({ userId: w.user_id, email: w.email ?? "", note: w.note, since: w.created_at, setBy: w.set_by_admin ? "Administrator" : "Founder", canChange: isAdmin || !w.set_by_admin }));
}

export async function addWaiver(uid: string, rawEmail: string, note?: string) {
  const { isAdmin } = await actor(uid);
  const email = rawEmail.trim().toLowerCase();
  const { data: profile } = await db.from("profiles").select("id, email").ilike("email", email.replace(/[%_\\]/g, "")).limit(1).maybeSingle();
  if (!profile || (profile.email ?? "").toLowerCase() !== email) throw new Error("No registered account has that email. The person needs to sign up first.");
  const { data: existing } = await dbx.from("fee_waivers").select("set_by_admin").eq("user_id", profile.id).is("revoked_at", null).maybeSingle() as { data: { set_by_admin: boolean } | null };
  if (existing?.set_by_admin && !isAdmin) throw new Error("An administrator paused this one. Only an administrator can change it.");
  const row = { user_id: profile.id, email, note: note?.trim() || null, created_by: uid, created_at: new Date().toISOString(), revoked_at: null, revoked_by: null, set_by_admin: isAdmin || !!existing?.set_by_admin };
  const { error } = await dbx.from("fee_waivers").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error("Could not pause the paywall for that person");
  await audit({ actor_id: uid, action: "fee_waiver_added", resource_type: "user", resource_id: profile.id, metadata: { email, by_admin: isAdmin } });
  return { userId: profile.id, email };
}

export async function removeWaiver(uid: string, userId: string) {
  const { isAdmin } = await actor(uid);
  const { data: existing } = await dbx.from("fee_waivers").select("set_by_admin").eq("user_id", userId).is("revoked_at", null).maybeSingle() as { data: { set_by_admin: boolean } | null };
  if (existing?.set_by_admin && !isAdmin) throw new Error("An administrator paused this one. Only an administrator can resume the paywall for them.");
  const { error } = await dbx.from("fee_waivers").update({ revoked_at: new Date().toISOString(), revoked_by: uid }).eq("user_id", userId).is("revoked_at", null);
  if (error) throw new Error("Could not resume the paywall for that person");
  await audit({ actor_id: uid, action: "fee_waiver_revoked", resource_type: "user", resource_id: userId, metadata: { by_admin: isAdmin } });
  return { ok: true as const };
}
