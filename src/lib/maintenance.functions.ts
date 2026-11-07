import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ms = () => import("@/lib/server/maintenance.server");

/** Public on purpose: the maintenance page has to be shown to people who are not signed in. It returns only on/off and the message. */
export const getMaintenanceStatus = createServerFn({ method: "GET" }).handler(async () => {
  try { return await (await ms()).getMaintenance(); } catch { return { enabled: false, message: null as string | null }; }
});

export const adminSetMaintenance = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ enabled: z.boolean(), message: z.string().max(500).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => (await ms()).setMaintenance(context.userId, data.enabled, data.message));

/** Own access in one call: the site pause, whether this person is blocked, and whether they are an administrator. Used by the page shell. */
export const getMyAccess = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await ms()).getMyAccess(context.userId));

export const adminSetUserBlock = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ targetId: z.string().uuid(), blocked: z.boolean(), message: z.string().max(500).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => (await ms()).setUserBlock(context.userId, data.targetId, data.blocked, data.message));
