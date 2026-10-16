import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const vs = () => import("@/lib/server/versions.server");
const id = z.string().uuid();

/** Version history for the submitting author or staff. Never returns file locations. */
export const getPaperVersions = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: id }).parse(d))
  .handler(async ({ data, context }) => (await vs()).listVersions(data.paperId, context.userId));

/** Administrator attaches a corrected manuscript to a published record (new version + permanent public notice, one transaction). */
export const adminIssueCorrectedVersion = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("Expected form data");
    const file = d.get("file");
    if (!(file instanceof File)) throw new Error("Attach the corrected manuscript as a PDF");
    const opt = (k: string, max: number) => { const v = String(d.get(k) ?? "").trim(); return v ? z.string().max(max).parse(v) : undefined; };
    return {
      paperlyId: z.string().regex(/^PLY-\d{4}-\d{6}$/).parse(String(d.get("paperlyId") ?? "").trim()), file,
      notice: z.string().trim().min(20).max(4000).parse(String(d.get("notice") ?? "")),
      reason: z.string().trim().min(10).max(1000).parse(String(d.get("reason") ?? "")),
      newTitle: opt("newTitle", 500), newAbstract: opt("newAbstract", 20000),
    };
  })
  .handler(async ({ data, context }) => {
    const { db } = await import("@/lib/server/core.server");
    const { data: p } = await db.from("papers").select("id").eq("paperly_id", data.paperlyId).maybeSingle();
    if (!p) throw new Error("No record with that Paperly ID");
    const { paperlyId: _unused, ...rest } = data;
    void _unused;
    return (await vs()).issueCorrectedVersion(context.userId, { ...rest, paperId: p.id });
  });
