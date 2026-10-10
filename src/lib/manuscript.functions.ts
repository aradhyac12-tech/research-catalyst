import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ms = () => import("@/lib/server/manuscript.server");
const id = z.string().uuid();

export const getManuscriptView = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id, assignmentId: id.optional() }).parse(d))
  .handler(async ({ data, context }) => (await ms()).manuscriptView(data.paperId, context.userId, data.assignmentId));
export const proposeTrackedChange = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id, field: z.enum(["title", "abstract", "keywords"]), after: z.string().max(20000), note: z.string().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => (await ms()).proposeEdit(data.paperId, context.userId, data.field, data.after, data.note));
export const withdrawTrackedChange = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ editId: id }).parse(d))
  .handler(async ({ data, context }) => { await (await ms()).withdrawEdit(data.editId, context.userId); return { ok: true }; });
export const decideTrackedChange = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ editId: id, accept: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await ms()).authorDecideEdit(data.editId, context.userId, data.accept));
