import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { zenodoCompleteConnect } from "@/lib/zenodo.functions";
import { PageTitle } from "@/lib/ui";

// Runs inside the signed-in app (not as an anonymous API route) so the server can require that the administrator finishing
// the Zenodo sign-in is the same person who started it.
export const Route = createFileRoute("/_authenticated/zenodo/callback")({
  head: () => ({ meta: [{ title: "Connecting Zenodo | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Connecting Zenodo | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    code: typeof s["code"] === "string" ? s["code"] : undefined,
    state: typeof s["state"] === "string" ? s["state"] : undefined,
    error: typeof s["error"] === "string" ? s["error"] : undefined,
  }),
  component: Callback,
});

function Callback() {
  const { code, state, error } = Route.useSearch();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(error ? { ok: false, text: "Zenodo sign-in was cancelled or denied." } : null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || error) return;
    started.current = true; // an authorization code can be used once
    if (!code || !state) { setResult({ ok: false, text: "This page needs to be opened from Zenodo." }); return; }
    zenodoCompleteConnect({ data: { code, state } })
      .then((r) => setResult({ ok: true, text: `Zenodo (${r.environment}) is connected${r.userName ? ` as ${r.userName}` : ""}. Press Test connection in the DOI screen to confirm.` }))
      .catch((e) => setResult({ ok: false, text: e instanceof Error ? e.message : "Could not connect Zenodo." }));
  }, [code, state, error]);
  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title="Zenodo" />
      {!result && <p role="status" className="text-muted-foreground">Confirming with Zenodo…</p>}
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "rounded-lg border border-border bg-wash px-4 py-3" : "rounded-lg border border-destructive bg-critical-soft px-4 py-3"}>{result.text}</p>}
      <p className="mt-6"><Link to="/admin" className="link">Back to administration</Link></p>
    </div>
  );
}
