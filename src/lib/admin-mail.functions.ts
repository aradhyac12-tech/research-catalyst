import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ACTION_MAX, BODY_MAX, INSTRUCTIONS_MAX, NAME_MAX, RECIPIENTS_MAX, SUBJECT_MAX } from "@/lib/domain/admin-email";

const am = () => import("@/lib/server/admin-mail.server");
const uid = z.string().uuid();

const oneTarget = (d: { userId?: string | undefined; emails?: string[] | undefined }) => !!d.userId !== !!(d.emails && d.emails.length);
export const adminDraftEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uid.optional(), name: z.string().max(NAME_MAX * 2).optional(), instructions: z.string().trim().min(10).max(INSTRUCTIONS_MAX), action: z.string().trim().max(ACTION_MAX).optional(), tone: z.enum(["friendly", "formal", "firm"]), length: z.enum(["short", "medium", "long"]) }).parse(d))
  .handler(async ({ data, context }) => (await am()).draftEmail(context.userId, data));
export const adminSendEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uid.optional(), emails: z.array(z.string().max(254)).max(RECIPIENTS_MAX + 5).optional(), subject: z.string().max(SUBJECT_MAX + 50), body: z.string().max(BODY_MAX + 500), draftId: uid.optional() }).refine(oneTarget, "Choose a registered user or enter e-mail addresses").parse(d))
  .handler(async ({ data, context }) => (await am()).sendEmail(context.userId, data));
export const adminEmailHistory = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uid.optional() }).parse(d))
  .handler(async ({ data, context }) => (await am()).emailHistory(context.userId, data.userId));
export const adminEmailRecipients = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().max(80).optional(), page: z.number().int().min(1).max(10000), recent: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await am()).listRecipients(context.userId, data));
