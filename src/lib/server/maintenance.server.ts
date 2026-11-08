import { db, dbx, audit, requireRole, getRoles, ADMINS } from "./core.server";

export type Maintenance = { enabled: boolean; message: string | null };

// The flag is read on every page load, so it is kept for a few seconds in memory. Switching it changes the cache at once on this server.
let cache: { at: number; value: Maintenance } | null = null;
const TTL = 2_000;

export async function getMaintenance(): Promise<Maintenance> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const { data } = await db.from("editorial_settings").select("maintenance_enabled, maintenance_message").eq("id", true).maybeSingle();
  // If the columns are not there yet (migration 0048 not applied) the site simply stays open.
  const row = data as { maintenance_enabled?: boolean | null; maintenance_message?: string | null } | null;
  const value: Maintenance = { enabled: row?.maintenance_enabled === true, message: row?.maintenance_message?.trim() || null };
  cache = { at: Date.now(), value };
  return value;
}

export async function setMaintenance(uid: string, enabled: boolean, message?: string | null) {
  await requireRole(uid, ADMINS);
  const patch: Record<string, unknown> = { maintenance_enabled: enabled, updated_by: uid, updated_at: new Date().toISOString() };
  if (message !== undefined) patch["maintenance_message"] = message && message.trim() ? message.trim().slice(0, 500) : null;
  const { error } = await db.from("editorial_settings").update(patch as never).eq("id", true);
  if (error) throw new Error("Could not change the pause. Apply migration 0048 first, then try again.");
  cache = null;
  await audit({ actor_id: uid, action: enabled ? "maintenance_on" : "maintenance_off", resource_type: "settings", resource_id: "maintenance", new_value: { enabled } });
  return getMaintenance();
}

/** Server-side backstop: while the site is paused, everyone except administrators is refused. Used by the actions that spend money or take uploads. */
export async function assertSiteOpen(uid: string) {
  const [m, b] = await Promise.all([getMaintenance(), getUserBlock(uid)]);
  if (!m.enabled && !b.blocked) return;
  if ((await getRoles(uid)).some((r) => ADMINS.includes(r))) return;
  if (b.blocked) throw new Error("Your access to Paperly has been paused by an administrator.");
  throw new Error("Paperly is under maintenance for a short while. Please try again soon. Sorry for the inconvenience.");
}

// ---------- block one person ----------
export type UserBlock = { blocked: boolean; message: string | null };
const blockCache = new Map<string, { at: number; value: UserBlock }>();

/** Is this person blocked? Kept for 2 seconds in memory; changing a block clears it at once on this server. */
export async function getUserBlock(uid: string): Promise<UserBlock> {
  const hit = blockCache.get(uid);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const { data } = await dbx.from("user_access_blocks").select("message").eq("user_id", uid).maybeSingle();
  // If migration 0049 is not applied yet, nobody is blocked.
  const row = data as { message?: string | null } | null;
  const value: UserBlock = { blocked: !!row, message: row?.message?.trim() || null };
  if (blockCache.size > 500) blockCache.clear();
  blockCache.set(uid, { at: Date.now(), value });
  return value;
}

/** Everything the screen needs about the caller's own access, in one call: pause + own block + whether they are an administrator. */
export async function getMyAccess(uid: string) {
  const [site, block, roles] = await Promise.all([getMaintenance(), getUserBlock(uid), getRoles(uid)]);
  const isAdmin = roles.some((r) => ADMINS.includes(r));
  return { site, blocked: isAdmin ? false : block.blocked, blockMessage: block.message, isAdmin };
}

export async function setUserBlock(uid: string, targetId: string, blocked: boolean, message?: string | null) {
  await requireRole(uid, ADMINS);
  if (targetId === uid) throw new Error("You cannot block yourself.");
  if ((await getRoles(targetId)).some((r) => ADMINS.includes(r))) throw new Error("An administrator cannot be blocked.");
  const clean = message && message.trim() ? message.trim().slice(0, 500) : null;
  const { error } = blocked
    ? await dbx.from("user_access_blocks").upsert({ user_id: targetId, message: clean, blocked_by: uid, blocked_at: new Date().toISOString() })
    : await dbx.from("user_access_blocks").delete().eq("user_id", targetId);
  if (error) throw new Error("Could not change the block. Apply migration 0049 first, then try again.");
  blockCache.delete(targetId);
  await audit({ actor_id: uid, action: blocked ? "user_blocked" : "user_unblocked", resource_type: "user", resource_id: targetId, new_value: { blocked } });
  return { userId: targetId, blocked };
}

export async function blockedIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await dbx.from("user_access_blocks").select("user_id").in("user_id", ids);
  return new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
}
