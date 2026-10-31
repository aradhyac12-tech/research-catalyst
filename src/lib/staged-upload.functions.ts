import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createStagedUpload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ name: z.string().min(1).max(255), size: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => (await import("@/lib/server/staged-upload.server")).createUploadTicket(context.userId, data.name, data.size));
