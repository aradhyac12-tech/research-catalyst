import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const fs = () => import("@/lib/server/founder.server");

export const listUsersForRoles = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().max(80).optional(), page: z.number().int().min(1).max(10000) }).parse(d))
  .handler(async ({ data, context }) => (await fs()).listUsers(context.userId, data));
export const getFounderSummary = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await fs()).founderSummary(context.userId));
export const getFounderTransactions = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ status: z.string().max(20).optional(), page: z.number().int().min(1).max(10000) }).parse(d))
  .handler(async ({ data, context }) => (await fs()).founderTransactions(context.userId, data));
