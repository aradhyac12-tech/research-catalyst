import { createFileRoute } from "@tanstack/react-router";

// Public, read-only. Reports which settings are present (names of MISSING ones only, never values) and whether the database answers.
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const present = (k: string) => Boolean(process.env[k]);
        const buildTime = {
          VITE_SUPABASE_URL: Boolean(import.meta.env["VITE_SUPABASE_URL"]),
          VITE_SUPABASE_PUBLISHABLE_KEY: Boolean(import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]),
        };
        const runtime = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map((k) => [k, present(k)] as const);
        const missingRequired = [...Object.entries(buildTime), ...runtime].filter(([, ok]) => !ok).map(([k]) => k);
        const optional = {
          payments_razorpay: present("RAZORPAY_KEY_ID") && present("RAZORPAY_KEY_SECRET") && present("RAZORPAY_WEBHOOK_SECRET"),
          ai_screening: present("GEMINI_API_KEY") || present("GROQ_API_KEY") || present("ANTHROPIC_API_KEY"),
          ai_providers: ["GEMINI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY"].filter(present).map((k) => k.replace("_API_KEY", "").toLowerCase()),
          public_site_url: present("PUBLIC_SITE_URL"),
          gmail_mail: present("GMAIL_SENDER") && (present("GMAIL_APP_PASSWORD") || (present("GMAIL_CLIENT_ID") && present("GMAIL_CLIENT_SECRET") && present("GMAIL_REFRESH_TOKEN"))),
          orcid_signin: present("ORCID_CLIENT_ID") && present("ORCID_CLIENT_SECRET") && present("ORCID_STATE_SECRET"),
          orcid_mode: "production",
          orcid_redirect_uri: `${(process.env["PUBLIC_SITE_URL"] ?? "").trim().replace(/\/+$/, "")}/orcid/callback`, // register exactly this in ORCID developer tools
        };
        let database: "ok" | "unreachable" | "skipped" = "skipped";
        if (!missingRequired.some((k) => k.startsWith("SUPABASE_"))) {
          try {
            const { db } = await import("@/lib/server/core.server");
            const q = db.from("identifier_types").select("identifier_type", { head: true, count: "exact" });
            const r = await Promise.race([q, new Promise<{ error: Error }>((res) => setTimeout(() => res({ error: new Error("timeout") }), 4000))]);
            database = (r as { error: unknown }).error ? "unreachable" : "ok";
          } catch { database = "unreachable"; }
        }
        const ok = missingRequired.length === 0 && database === "ok";
        if (!ok) console.error(JSON.stringify({ ts: new Date().toISOString(), event: "health_failed", missingRequired, database }));
        return new Response(JSON.stringify({ ok, missingRequired, database, optional, commit: process.env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) ?? null }), {
          status: ok ? 200 : 503,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
