import { createFileRoute } from "@tanstack/react-router";

/**
 * Public referral link: https://<site>/r/K7XM92QF
 *
 * The code is random and opaque: it holds no name, initials, username or id. This route never looks the code up and never says whether it
 * is real. Every well-formed code gets the same answer (remember it in an HttpOnly cookie, go to sign-up), so the address cannot be used
 * to discover codes or partners. The code is checked later, on the server, when an account is created or a paper is submitted
 * (see server/referrals.server.ts). The visitor is sent on without the code in the address bar.
 */
export const Route = createFileRoute("/r/$code")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { normalizeReferralCode, buildReferralCookie } = await import("@/lib/domain/referrals");
        const code = normalizeReferralCode(params.code);
        const headers = new Headers({
          Location: "/auth?join=1",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Robots-Tag": "noindex, nofollow",
        });
        if (code) {
          const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
          headers.append("Set-Cookie", buildReferralCookie(code, secure));
        }
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
