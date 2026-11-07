import { createFileRoute } from "@tanstack/react-router";

// Razorpay Dashboard -> Settings -> Webhooks: point to this URL, events payment.captured, payment.failed, order.paid.
export const Route = createFileRoute("/api/public/payments/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 200_000) return new Response("too large", { status: 413 });
        const { handleRazorpayWebhook } = await import("@/lib/server/payments.server");
        const origin = new URL(request.url).origin;
        try {
          const r = await handleRazorpayWebhook(raw, request.headers, origin);
          return new Response(r.body, { status: r.status });
        } catch {
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});
