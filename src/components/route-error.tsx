import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { classifyError, newErrorId } from "@/lib/errors";

/** Shared error screen: calm wording, a reference ID the visitor can quote, and a report to the server log. */
export function RouteError({ error, reset, compact = false }: { error: unknown; reset?: () => void; compact?: boolean }) {
  const router = useRouter();
  const id = useMemo(() => newErrorId(), []);
  const info = useMemo(() => classifyError(error), [error]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error(error);
    try {
      const body = JSON.stringify({ id, code: info.code, message: error instanceof Error ? error.message : String(error), path: window.location.pathname });
      if (!(navigator.sendBeacon && navigator.sendBeacon("/api/public/client-error", new Blob([body], { type: "application/json" })))) {
        void fetch("/api/public/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch { /* reporting must never throw */ }
  }, [error, id, info.code]);

  return (
    <div role="alert" className={compact ? "mx-auto max-w-3xl px-5 py-10" : "flex min-h-screen items-center justify-center bg-background px-4"}>
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{info.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{info.message}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          Reference <span className="font-mono font-medium text-foreground">{id}</span>{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => { void navigator.clipboard?.writeText(id).then(() => setCopied(true)).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {info.retryable && (
            <button onClick={() => { void router.invalidate(); reset?.(); }} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Try again</button>
          )}
          {info.code === "UNAUTHENTICATED" && (
            <a href="/auth" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Sign in</a>
          )}
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">Go home</a>
        </div>
      </div>
    </div>
  );
}
