import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["app_role"];
export type PaperStatus = Database["public"]["Enums"]["paper_status"];
export const db = supabaseAdmin;

/** Structured log line; never include manuscript text, credentials or card data. */
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

export async function getRoles(userId: string): Promise<Role[]> {
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role);
}

export async function requireRole(userId: string, allowed: Role[]) {
  const roles = await getRoles(userId);
  if (!roles.some((r) => allowed.includes(r))) throw new Error("Forbidden: insufficient role");
  return roles;
}
export const STAFF: Role[] = ["editor", "admin", "super_admin"];
export const ADMINS: Role[] = ["admin", "super_admin"];

export async function audit(entry: {
  actor_id?: string | null; actor_type?: "USER" | "SYSTEM" | "AI" | "PROVIDER"; action: string;
  resource_type: string; resource_id?: string | null; old_value?: unknown; new_value?: unknown; metadata?: Record<string, unknown>;
}) {
  const { error } = await db.from("audit_logs").insert({
    actor_id: entry.actor_id ?? null, actor_type: entry.actor_type ?? "USER", action: entry.action,
    resource_type: entry.resource_type, resource_id: entry.resource_id ?? null,
    old_value: (entry.old_value ?? null) as never, new_value: (entry.new_value ?? null) as never, metadata: (entry.metadata ?? {}) as never,
  });
  if (error) log("audit_write_failed", { action: entry.action, error: error.message });
}

export async function notify(userId: string, kind: string, title: string, body: string, link?: string) {
  // Email delivery is not configured yet; notifications are in-app and marked NOT_CONFIGURED for email.
  await db.from("notifications").insert({ user_id: userId, kind, title, body, link: link ?? null, email_status: "NOT_CONFIGURED" });
}

export async function transition(paperId: string, to: PaperStatus, actor: string | null, actorType: "USER" | "SYSTEM" | "AI" | "PROVIDER", reason: string, override = false, metadata: Record<string, unknown> = {}) {
  const { error } = await db.rpc("transition_paper", {
    _paper_id: paperId, _to: to, _actor: actor as string, _actor_type: actorType, _reason: reason, _override: override, _metadata: metadata as never,
  });
  if (error) throw new Error(error.message);
}

export async function getStatus(paperId: string): Promise<PaperStatus> {
  const { data, error } = await db.from("papers").select("status").eq("id", paperId).single();
  if (error || !data) throw new Error("Paper not found");
  return data.status;
}

export function siteOrigin(request?: Request | null) {
  try { if (request) return new URL(request.url).origin; } catch { /* ignore */ }
  return process.env["PUBLIC_SITE_URL"] ?? "";
}
