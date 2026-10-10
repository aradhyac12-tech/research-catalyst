import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { db } = await import("@/lib/server/core.server");
        const { buildSitemap } = await import("@/lib/domain/metadata");
        const origin = new URL(request.url).origin;
        const { data } = await db.from("papers").select("paperly_id, updated_at").in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).eq("restricted", false).order("published_at", { ascending: false }).limit(5000);
        return new Response(buildSitemap(origin, data ?? []), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      },
    },
  },
});
