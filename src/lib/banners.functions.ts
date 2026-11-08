import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const core = () => import("@/lib/server/core.server");
const bn = () => import("@/lib/server/banners.server");

/** Public: the banners a visitor should see now. Nothing here depends on who is asking. */
export const getActiveBanners = createServerFn({ method: "GET" }).handler(async () => {
  try { return await (await bn()).publicBanners(); } catch { return []; } // a banner problem must never break a page
});

export const adminListBanners = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requirePermission } = await core();
  await requirePermission(context.userId, "PAYMENT_MANAGE");
  return (await bn()).adminListBanners();
});

export const adminSaveBanner = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(90),
    message: z.string().trim().max(240),
    theme: z.string().max(20),
    placement: z.string().max(20),
    promoId: z.string().uuid().nullable().optional(),
    newPromo: z.object({
      code: z.string().trim().min(3).max(32),
      amountOffMinor: z.number().int().positive().max(100_000_000),
      maxRedemptions: z.number().int().positive().max(1_000_000).nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    }).nullable().optional(),
    ctaLabel: z.string().trim().max(30).nullable().optional(),
    ctaUrl: z.string().trim().max(500).nullable().optional(),
    showCountdown: z.boolean(), showRemaining: z.boolean(), dismissible: z.boolean(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requirePermission } = await core();
    await requirePermission(context.userId, "PAYMENT_MANAGE");
    return (await bn()).adminSaveBanner(context.userId, data);
  });

export const adminSetBannerActive = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requirePermission } = await core();
    await requirePermission(context.userId, "PAYMENT_MANAGE");
    await (await bn()).adminSetBannerActive(context.userId, data.id, data.active);
    return { ok: true };
  });

export const adminDeleteBanner = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requirePermission } = await core();
    await requirePermission(context.userId, "PAYMENT_MANAGE");
    await (await bn()).adminDeleteBanner(context.userId, data.id);
    return { ok: true };
  });
