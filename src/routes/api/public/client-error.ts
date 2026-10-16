import { createFileRoute } from "@tanstack/react-router";
import { sanitizeClientReport } from "@/lib/errors";

// Browsers report a crash here so the reference ID shown to the visitor can be found in the server logs. Log-only: no database writes.
const hits = new Map<string, { n: number; reset: number }>();
const LIMIT = 20, WINDOW_MS = 60_000;

export const Route = createFileRoute("/api/public/client-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const now = Date.now();
        const h = hits.get(ip);
        if (!h || h.reset < now) hits.set(ip, { n: 1, reset: now + WINDOW_MS });
        else if (++h.n > LIMIT) return new Response(null, { status: 429 });
        if (hits.size > 5000) hits.clear();
        const raw = await request.text();
        if (raw.length > 4096) return new Response(null, { status: 413 });
        let report: ReturnType<typeof sanitizeClientReport> = null;
        try { report = sanitizeClientReport(JSON.parse(raw)); } catch { /* ignore */ }
        if (!report) return new Response(null, { status: 400 });
        console.error(JSON.stringify({ ts: new Date().toISOString(), event: "client_error", ...report }));
        return new Response(null, { status: 204 });
      },
    },
  },
});
