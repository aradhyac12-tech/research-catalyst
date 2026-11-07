import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { submissionSchema } from "@/lib/app.functions";

const eth = () => import("@/lib/server/ethics.server");
const uuid = z.string().uuid();

export const listEthicsQueue = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => (await eth()).listEthicsQueue(context.userId));

export const getEthicsCase = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await eth()).getEthicsCaseForReviewer(context.userId, data.caseId));

export const decideEthicsCase = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    caseId: uuid,
    to: z.enum(["ETHICS_UNDER_REVIEW", "ETHICS_REVISION_REQUIRED", "ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_HUMAN_REVIEW_REQUIRED"]),
    reason: z.string().trim().max(4000).default(""),
    structuredReasons: z.array(z.object({ code: z.string().trim().min(2).max(60), detail: z.string().trim().max(500).optional() })).max(20).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => (await eth()).decideEthics(context.userId, data.caseId, data.to, data.reason, data.structuredReasons));

export const verifyTrialRegistrationFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: uuid, result: z.enum(["VERIFIED_MANUAL", "VERIFICATION_FAILED"]), reason: z.string().trim().min(10).max(2000) }).parse(d))
  .handler(async ({ data, context }) => (await eth()).verifyTrialRegistration(context.userId, data.paperId, data.result, data.reason));

export const adminEthicsAssignmentQueue = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => (await eth()).listEthicsAssignmentQueue(context.userId));

export const adminAssignEthicsReviewer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: uuid, reviewerId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await eth()).assignEthicsReviewer(context.userId, data.caseId, data.reviewerId));

export const getMyEthicsStatus = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await eth()).getMyEthics(context.userId, data.paperId));

// Amendments append a new declaration revision (with reason) and re-open ethics review where needed. No status can be set from here.
export const amendRights = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: uuid, rights: submissionSchema.shape.rights, reason: z.string().trim().min(10).max(1000) }).parse(d))
  .handler(async ({ data, context }) => (await eth()).amendRightsDeclaration(context.userId, data.paperId, data.rights, data.reason));

export const amendEthics = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: uuid, articleType: z.string().min(2).max(80), ethics: submissionSchema.shape.ethics, reason: z.string().trim().min(10).max(1000) }).parse(d))
  .handler(async ({ data, context }) => (await eth()).amendEthicsDeclaration(context.userId, data.paperId, data.ethics as never, data.articleType, data.reason));
