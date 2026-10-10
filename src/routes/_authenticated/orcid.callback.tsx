import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { completeOrcidLink } from "@/lib/app.functions";
import { PageTitle } from "@/lib/ui";

// Runs inside the signed-in app (not as an anonymous API route) so the server can require that the person finishing
// the ORCID sign-in is the same person who started it.
export const Route = createFileRoute("/_authenticated/orcid/callback")({
  head: () => ({ meta: [{ title: "Connecting ORCID | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Connecting ORCID | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    code: typeof s["code"] === "string" ? s["code"] : undefined,
    state: typeof s["state"] === "string" ? s["state"] : undefined,
    error: typeof s["error"] === "string" ? s["error"] : undefined,
  }),
  component: Callback,
});

function Callback() {
  const { code, state, error } = Route.useSearch();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(error ? { ok: false, text: "ORCID sign-in was cancelled or denied." } : null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || error) return;
    started.current = true; // an authorization code can be used once
    if (!code || !state) { setResult({ ok: false, text: "This page needs to be opened from ORCID." }); return; }
    completeOrcidLink({ data: { code, state } })
      .then((r) => setResult({ ok: true, text: `Verified ${r.orcid}.` }))
      .catch((e) => setResult({ ok: false, text: e instanceof Error ? e.message : "Could not verify your ORCID iD." }));
  }, [code, state, error]);
  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title="ORCID" />
      {!result && <p role="status" className="text-muted-foreground">Confirming with ORCID…</p>}
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "border-l-4 border-border bg-wash px-4 py-3" : "border-l-4 border-destructive bg-critical-soft px-4 py-3"}>{result.text}</p>}
      <p className="mt-6"><Link to="/profile" className="link">Back to your profile</Link></p>
    </div>
  );
}
