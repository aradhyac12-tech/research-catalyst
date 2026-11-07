import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { buildRobots } = await import("@/lib/domain/metadata");
        return new Response(buildRobots(new URL(request.url).origin), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      },
    },
  },
});
