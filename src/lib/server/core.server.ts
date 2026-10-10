import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { hasPermission, type Permission } from "@/lib/domain/permissions";

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
/** Server-side permission gate. Roles are only a way to hold permissions (see domain/permissions.ts). */
export async function requirePermission(userId: string, perm: Permission) {
  const roles = await getRoles(userId);
  if (!hasPermission(roles, perm)) throw new Error("Forbidden: insufficient permission");
  return roles;
}

/** Objects created by migration 0010 are not in the generated Supabase types yet; this is the one place that casts. */
interface RpcResult { data: unknown; error: { message: string } | null }
interface LooseDb {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}
export const dbx = supabaseAdmin as unknown as LooseDb;

export const STAFF: Role[] = ["editor", "admin", "super_admin"];
export const ADMINS: Role[] = ["admin", "super_admin"];
export const FOUNDERS: Role[] = ["founder"];

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
  // Notifications are in-app first; email_status stays NOT_CONFIGURED until the GMAIL_* settings exist.
  const { data } = await db.from("notifications").insert({ user_id: userId, kind, title, body, link: link ?? null, email_status: "NOT_CONFIGURED" }).select("id").single();
  // The same event is also e-mailed through Gmail (see mail.server.ts). queueNotificationEmail never throws.
  if (data?.id) await (await import("./mail.server")).queueNotificationEmail({ id: data.id, userId, kind, title, body, link: link ?? null });
}

export async function transition(paperId: string, to: PaperStatus, actor: string | null, actorType: "USER" | "SYSTEM" | "AI" | "PROVIDER", reason: string, override = false, metadata: Record<string, unknown> = {}) {
  const { error } = await db.rpc("transition_paper", {
    _paper_id: paperId, _to: to, _actor: actor as string, _actor_type: actorType, _reason: reason, _override: override, _metadata: metadata as never,
  });
  if (error) throw new Error(error.message);
  // Plain-language status update for the author. Decisions, publication and payments send their own, richer messages.
  const msg = AUTHOR_STATUS_UPDATES[to];
  if (msg) {
    const { data: p } = await db.from("papers").select("owner_id, title").eq("id", paperId).maybeSingle();
    if (p?.owner_id) await notify(p.owner_id, "status_update", msg.title, `“${p.title}”: ${msg.body}`, `/my-research/${paperId}`);
  }
}

const AUTHOR_STATUS_UPDATES: Partial<Record<PaperStatus, { title: string; body: string }>> = {
  PEER_REVIEW: { title: "Your paper is under peer review", body: "reviewers have been assigned and are reading your manuscript." },
  EDITORIAL_DECISION: { title: "Reviews are complete", body: "the editor is now preparing a decision." },
  PUBLICATION_PENDING: { title: "Your paper is being prepared for publication", body: "we are preparing the public record and your certificate." },
};

export async function getStatus(paperId: string): Promise<PaperStatus> {
  const { data, error } = await db.from("papers").select("status").eq("id", paperId).single();
  if (error || !data) throw new Error("Paper not found");
  return data.status;
}

export function siteOrigin(request?: Request | null) {
  try { if (request) return new URL(request.url).origin; } catch { /* ignore */ }
  return process.env["PUBLIC_SITE_URL"] ?? "";
}

/** Public address used inside certificates (the QR code and the printed link). Prefers the configured site URL, then the address the
 *  request came in on, then Vercel's production domain. It never falls back to a different deployment when any of those exist. */
export function certificateSiteUrl(requestOrigin?: string) {
  const clean = (u?: string) => (u ?? "").trim().replace(/\/+$/, "");
  const vercel = process.env["VERCEL_PROJECT_PRODUCTION_URL"] ? `https://${process.env["VERCEL_PROJECT_PRODUCTION_URL"]}` : "";
  return clean(process.env["PUBLIC_SITE_URL"]) || clean(requestOrigin) || clean(vercel) || "https://paperlys.lovable.app";
}
