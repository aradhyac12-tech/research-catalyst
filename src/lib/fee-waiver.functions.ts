import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const fw = () => import("@/lib/server/fee-waiver.server");

export const listFeeWaivers = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await fw()).listWaivers(context.userId));
export const addFeeWaiver = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ email: z.string().trim().email().max(254), note: z.string().trim().max(300).optional() }).parse(d))
  .handler(async ({ data, context }) => (await fw()).addWaiver(context.userId, data.email, data.note));
export const removeFeeWaiver = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await fw()).removeWaiver(context.userId, data.userId));
