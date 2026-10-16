import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ar = () => import("@/lib/server/article-removal.server");

export const adminFindArticle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reference: z.string().trim().min(3).max(40) }).parse(d))
  .handler(async ({ data, context }) => (await ar()).findArticle(context.userId, data.reference));
export const adminRemoveArticle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), reason: z.string().trim().min(10).max(500), confirm: z.string().trim().min(3).max(40) }).parse(d))
  .handler(async ({ data, context }) => (await ar()).removeArticle(context.userId, data.paperId, data.reason, data.confirm));
export const adminRestoreArticle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await ar()).restoreArticle(context.userId, data.paperId));
export const adminListRemovedArticles = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await ar()).listRemoved(context.userId));
export const adminListArticles = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().trim().max(60).optional() }).parse(d))
  .handler(async ({ data, context }) => (await ar()).listArticles(context.userId, data.query));
export const adminEraseArticle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), reason: z.string().trim().min(10).max(500), confirm: z.string().trim().min(3).max(40) }).parse(d))
  .handler(async ({ data, context }) => (await ar()).eraseArticle(context.userId, data.paperId, data.reason, data.confirm));

// ---------- per-author certificate hold (administrators only) ----------
const ac = () => import("@/lib/server/author-certificates.server");
const siteOriginOf = async () => (await import("@/lib/server/core.server")).certificateSiteUrl();
export const adminListPaperAuthorCertificates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await ac()).listPaperAuthorCertificates(context.userId, data.paperId));
export const adminPauseAuthorCertificate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ authorId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).parse(d))
  .handler(async ({ data, context }) => (await ac()).pauseAuthorCertificate(context.userId, data.authorId, data.reason));
export const adminResumeAuthorCertificate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ authorId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await ac()).resumeAuthorCertificate(context.userId, data.authorId, await siteOriginOf()));
