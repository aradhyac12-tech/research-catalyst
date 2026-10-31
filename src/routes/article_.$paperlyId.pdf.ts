import { createFileRoute } from "@tanstack/react-router";

/**
 * Public full-text PDF of a published record, on the same host as its article page. Google Scholar needs exactly this:
 * the article page names it in `citation_pdf_url`, and the file must open without sign-in.
 * Only the current version of a public record is served, and only when it is a PDF. Everything else is a plain 404.
 * (Lives outside /api/ because robots.txt disallows /api/ for crawlers.)
 */
export const Route = createFileRoute("/article_/$paperlyId/pdf")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });
        const { PAPERLY_ID_RE } = await import("@/lib/domain/scholarly");
        if (!PAPERLY_ID_RE.test(params.paperlyId)) return notFound();
        const { db } = await import("@/lib/server/core.server");
        const { data: p } = await db.from("papers").select("paperly_id, current_version_id").eq("paperly_id", params.paperlyId)
          .in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).eq("restricted", false).is("deleted_at", null).maybeSingle();
        if (!p?.current_version_id) return notFound();
        const { data: v } = await db.from("paper_versions").select("storage_path, mime_type").eq("id", p.current_version_id).maybeSingle();
        if (!v || v.mime_type !== "application/pdf" || !v.storage_path) return notFound();
        const file = await db.storage.from("manuscripts").download(v.storage_path);
        if (file.error || !file.data) return notFound();
        return new Response(await file.data.arrayBuffer(), {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${p.paperly_id}.pdf"`, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
        });
      },
    },
  },
});
