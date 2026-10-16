import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BODY_MAX, INSTRUCTIONS_MAX, SUBJECT_MAX } from "@/lib/domain/admin-email";

const am = () => import("@/lib/server/admin-mail.server");
const uid = z.string().uuid();

export const adminDraftEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uid, instructions: z.string().trim().min(10).max(INSTRUCTIONS_MAX), tone: z.enum(["friendly", "formal", "firm"]) }).parse(d))
  .handler(async ({ data, context }) => (await am()).draftEmail(context.userId, data));
export const adminSendEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uid, subject: z.string().max(SUBJECT_MAX + 50), body: z.string().max(BODY_MAX + 500), draftId: uid.optional() }).parse(d))
  .handler(async ({ data, context }) => (await am()).sendEmail(context.userId, data));
export const adminEmailHistory = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uid.optional() }).parse(d))
  .handler(async ({ data, context }) => (await am()).emailHistory(context.userId, data.userId));
export const adminEmailRecipients = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().max(80).optional(), page: z.number().int().min(1).max(10000), recent: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await am()).listRecipients(context.userId, data));
