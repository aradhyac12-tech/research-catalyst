import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Every function here is administrator-only. The permission check (REFERRAL_ADMIN) is made INSIDE server/referrals.server.ts,
// at the top of each admin* function, so it cannot be skipped by a new call site. Partner identity leaves the server only here.
const rf = () => import("@/lib/server/referrals.server");
const origin = () => { try { return new URL(getRequest().url).origin; } catch { return process.env["PUBLIC_SITE_URL"] ?? ""; } };

const partnerInput = z.object({
  displayName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(254).nullable().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const adminListReferralPartners = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await rf()).adminListPartners(context.userId, origin()));

export const adminCreateReferralPartner = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => partnerInput.parse(d))
  .handler(async ({ data, context }) => (await rf()).adminCreatePartner(context.userId, data, origin()));

export const adminUpdateReferralPartner = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => partnerInput.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => { await (await rf()).adminUpdatePartner(context.userId, data.id, data); return { ok: true }; });

export const adminSetReferralPartnerActive = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => { await (await rf()).adminSetPartnerActive(context.userId, data.id, data.active); return { ok: true }; });

export const adminRotateReferralLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await rf()).adminRotateLink(context.userId, data.id, origin()));

export const adminGetPaperReferral = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await rf()).adminGetPaperReferral(context.userId, data.paperId));

export const adminSetPaperReferralShares = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    paperId: z.string().uuid(),
    shares: z.array(z.object({ partnerId: z.string().uuid(), sharePercent: z.number().min(0.01).max(100) })).min(1).max(10),
  }).parse(d))
  .handler(async ({ data, context }) => { await (await rf()).adminSetPaperShares(context.userId, data.paperId, data.shares); return { ok: true }; });

export const adminClearPaperReferral = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => { await (await rf()).adminClearPaperShares(context.userId, data.paperId); return { ok: true }; });

export const adminReferralRecent = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await rf()).adminRecentAttributions(context.userId));

export const adminListReferralUsers = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().max(80).optional(), page: z.number().int().min(1).max(100000) }).parse(d))
  .handler(async ({ data, context }) => (await rf()).adminListReferralUsers(context.userId, data, origin()));

export const adminSetUserReferral = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ subjectId: z.string().uuid(), discountMinor: z.number().int().min(0).max(100_000_000) }).parse(d))
  .handler(async ({ data, context }) => (await rf()).adminSetUserReferral(context.userId, data, origin()));

export const adminListReferralDiscounts = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ page: z.number().int().min(1).max(100000) }).parse(d))
  .handler(async ({ data, context }) => (await rf()).adminListReferralDiscounts(context.userId, data.page));
