import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sc = () => import("@/lib/server/scholarly.server");

export const validatePaperReferences = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await sc()).validateReferences(data.paperId, context.userId));

export const myPaperReferences = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, requireRole, STAFF } = await import("@/lib/server/core.server");
    const { data: p } = await db.from("papers").select("owner_id").eq("id", data.paperId).single();
    if (!p) throw new Error("Not found");
    if (p.owner_id !== context.userId) await requireRole(context.userId, STAFF);
    const { data: refs } = await db.from("paper_references").select("position, raw_text, doi, validation_status, validation_note, validated_at").eq("paper_id", data.paperId).order("position");
    return refs ?? [];
  });

export const adminIssueNotice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    paperlyId: z.string().regex(/^PLY-\d{4}-\d{6}$/),
    kind: z.enum(["ERRATUM", "ADDENDUM", "EXPRESSION_OF_CONCERN", "CORRECTION", "RETRACTION", "WITHDRAWAL"]),
    notice: z.string().trim().min(20).max(4000), reason: z.string().trim().min(10).max(2000),
    newTitle: z.string().trim().min(5).max(400).optional(), newAbstract: z.string().trim().min(50).max(5000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/lib/server/core.server");
    const { data: p } = await db.from("papers").select("id").eq("paperly_id", data.paperlyId).maybeSingle();
    if (!p) throw new Error("No record with that Paperly ID");
    return (await sc()).issueNotice({ paperId: p.id, uid: context.userId, kind: data.kind, notice: data.notice, reason: data.reason, newTitle: data.newTitle, newAbstract: data.newAbstract });
  });

export const myDashboard = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import("@/lib/server/dashboard.server")).dashboardFor(context.userId));
