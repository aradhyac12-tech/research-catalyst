import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const rv = () => import("@/lib/server/review.server");
const id = z.string().uuid();
const outcome = z.enum(["ACCEPT", "MINOR_REVISION", "MAJOR_REVISION", "REJECT"]);

// ---- editor ----
export const editorSetPublicationType = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id, type: z.enum(["REPOSITORY_RECORD", "PREPRINT", "JOURNAL_ARTICLE"]) }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).setPublicationType(data.paperId, context.userId, data.type); return { ok: true }; });
export const editorStartPeerReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).startPeerReview(data.paperId, context.userId); return { ok: true }; });
export const editorInviteReviewer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id, reviewerId: id, days: z.number().int().min(3).max(90).optional() }).parse(d))
  .handler(async ({ data, context }) => (await rv()).inviteReviewer(data.paperId, context.userId, data.reviewerId, data.days));
export const editorReplaceReviewer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ assignmentId: id, newReviewerId: id }).parse(d))
  .handler(async ({ data, context }) => (await rv()).replaceReviewer(data.assignmentId, context.userId, data.newReviewerId));
export const editorExtendDeadline = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ assignmentId: id, days: z.number().int().min(1).max(60) }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).extendDeadline(data.assignmentId, context.userId, data.days); return { ok: true }; });
export const editorReviews = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id }).parse(d))
  .handler(async ({ data, context }) => (await rv()).editorReviews(data.paperId, context.userId));
export const editorCloseReviews = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id, reason: z.string().trim().min(10).max(1000) }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).closeReviews(data.paperId, context.userId, data.reason); return { ok: true }; });
export const editorDecide = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id, outcome, reason: z.string().trim().max(4000).optional() }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).recordDecision(data.paperId, context.userId, data.outcome, data.reason); return { ok: true }; });
export const editorListReviewers = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await rv()).listReviewers(context.userId));

// ---- reviewer ----
export const myReviewInvitations = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await rv()).myInvitations(context.userId));
export const respondToReviewInvitation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id, accept: z.boolean(), coi: z.enum(["NONE", "POTENTIAL", "CONFLICT"]), coiStatement: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).respondToInvitation(data.id, context.userId, data.accept, data.coi, data.coiStatement); return { ok: true }; });
export const reviewerManuscript = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => (await rv()).reviewerManuscript(data.id, context.userId));
export const submitPeerReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id, recommendation: outcome, comments_to_author: z.string().trim().max(20000).optional(), confidential_to_editor: z.string().max(10000).optional() }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).submitReview(data.id, context.userId, data); return { ok: true }; });

// ---- author ----
export const getMyReviews = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id }).parse(d))
  .handler(async ({ data, context }) => (await rv()).authorReviews(data.paperId, context.userId));
export const submitRevision = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("Expected form data");
    const file = d.get("file"), anon = d.get("anonymized_file");
    if (!(file instanceof File)) throw new Error("Attach the revised manuscript as a PDF");
    return {
      paperId: id.parse(String(d.get("paperId"))), file, anonymized: anon instanceof File && anon.size > 0 ? anon : undefined,
      response: z.string().trim().min(20).max(20000).parse(String(d.get("response") ?? "")), summary: z.string().trim().min(10).max(1000).parse(String(d.get("summary") ?? "")),
    };
  })
  .handler(async ({ data, context }) => (await rv()).resubmitRevision(context.userId, data));
export const withdrawMyPaper = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id, reason: z.string().trim().min(10).max(1000) }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).withdrawPaper(data.paperId, context.userId, data.reason); return { ok: true }; });

// ---- admin ----
export const adminGetSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => { const { requireRole, ADMINS } = await import("@/lib/server/core.server"); await requireRole(context.userId, ADMINS); return (await rv()).getSettings(); });
export const adminUpdateSettings = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ journal_mode_enabled: z.boolean().optional(), default_review_model: z.enum(["SINGLE_ANONYMOUS", "DOUBLE_ANONYMOUS", "OPEN"]).optional(), reviews_required: z.number().int().min(1).max(5).optional(), review_days: z.number().int().min(3).max(90).optional() }).parse(d))
  .handler(async ({ data, context }) => { await (await rv()).updateSettings(context.userId, data); return { ok: true }; });
export const adminSetRole = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid().optional(), email: z.string().email().optional(), role: z.enum(["editor", "reviewer", "founder"]), grant: z.boolean() })
    .refine((v) => !!v.userId || !!v.email, "Choose a user").parse(d))
  .handler(async ({ data, context }) => (await rv()).setRole(context.userId, { userId: data.userId, email: data.email }, data.role, data.grant));

export const addAnonymizedCopy = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("Expected form data");
    const file = d.get("file");
    if (!(file instanceof File)) throw new Error("Attach the anonymized manuscript as a PDF");
    return { paperId: id.parse(String(d.get("paperId"))), file };
  })
  .handler(async ({ data, context }) => { await (await rv()).addAnonymizedCopy(context.userId, data.paperId, data.file); return { ok: true }; });
