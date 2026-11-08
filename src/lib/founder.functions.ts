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
export const getFounderSharedPayments = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ page: z.number().int().min(1).max(10000) }).parse(d))
  .handler(async ({ data, context }) => (await fs()).founderSharedPayments(context.userId, data));
export const adminSetFounderDues = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), due: z.boolean(), note: z.string().trim().max(300).optional() }).parse(d))
  .handler(async ({ data, context }) => (await fs()).setFounderDues(context.userId, data.userId, data.due, data.note));
export const getFounderHold = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await fs()).founderHold(context.userId));
export const getFounderUserNames = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ page: z.number().int().min(1).max(10000) }).parse(d))
  .handler(async ({ data, context }) => (await fs()).founderUserNames(context.userId, data));
export const listFounderDuesHolds = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await fs()).listDuesHolds(context.userId));
export const adminResolveDeferral = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ deferralId: z.string().uuid(), outcome: z.enum(["PAID", "CANCELLED"]) }).parse(d))
  .handler(async ({ data, context }) => (await fs()).resolveDeferral(context.userId, data.deferralId, data.outcome));
