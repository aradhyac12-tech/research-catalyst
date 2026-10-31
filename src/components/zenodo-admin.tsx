import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { zenodoApprovePublication, zenodoConnectUrl, zenodoDisconnect, zenodoOverview, zenodoRetry, zenodoSetProduction, zenodoTestConnection, zenodoUpdateMetadata } from "@/lib/zenodo.functions";
import { DoiLink } from "@/components/doi-link";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/ui";

/** What an administrator should do about each error code. Messages never contain the access token. */
const ACTION: Record<string, string> = {
  ZENODO_AUTH_FAILED: "Zenodo refused the token. Press Connect Zenodo again (or check ZENODO_ACCESS_TOKEN, scopes deposit:write and deposit:actions), then press Retry.",
  ZENODO_METADATA_REJECTED: "Zenodo rejected the data. Correct the title, authors, licence or file in the article record, then press Retry.",
  ZENODO_RATE_LIMITED: "Zenodo is limiting requests. It retries automatically; no action is needed.",
  ZENODO_TIMEOUT: "Zenodo was slow. The outcome is checked with Zenodo before anything is repeated; no action is needed.",
  ZENODO_CREATE_UNCERTAIN: "A create request got no answer. The next attempt looks for the deposit on Zenodo first, so no duplicate is made.",
  ZENODO_PUBLISH_UNCERTAIN: "A publish request got no answer. The next attempt checks the record on Zenodo first.",
  FILE_HASH_MISMATCH: "The stored manuscript does not match its checksum. Investigate the file before retrying.",
  VALIDATION_FILE_NOT_PDF: "The manuscript must be a PDF or a Word (.docx) file (Word files are converted to PDF automatically). Upload a PDF or .docx version, then press Retry.",
  VALIDATION_LICENSE_NOT_OPEN: "A Zenodo DOI needs an open (Creative Commons) licence. Change the licence with the author's agreement, then press Retry.",
  DOI_NOT_CONFIRMED: "Zenodo did not confirm a DOI. Nothing is shown as registered. Press Retry; if it repeats, open the Zenodo record.",
};
const hint = (code: string | null) => (code ? ACTION[code] ?? (code.startsWith("VALIDATION_") ? "Fix the missing or invalid data named above, then press Retry." : "Press Retry. If it fails again, contact the platform developer with this code.") : null);
const LABEL: Record<string, string> = { pending: "Pending", uploading: "Uploading", publishing: "Publishing", registered: "Registered", failed: "Failed", not_started: "Not started" };

export function ZenodoAdmin() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["zenodo-overview"], queryFn: () => zenodoOverview(), refetchInterval: 15000 });
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["zenodo-overview"] });
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { const r = (await fn()) as { outcome?: string; code?: string; message?: string } | undefined; if (r?.outcome === "failed") toast.error(`${r.code}: ${r.message}`); else if (r?.outcome === "not_configured") toast.error(r.message ?? "Zenodo is not configured"); else toast.success(ok); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(null); refresh(); }
  };
  const setProd = useMutation({ mutationFn: (enabled: boolean) => zenodoSetProduction({ data: { enabled } }), onSuccess: refresh, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change") });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error || !data) return <p role="alert" className="rounded-lg border border-destructive bg-critical-soft px-4 py-3">You do not have access to DOI registration.</p>;
  const c = data.config;
  return (
    <div className="space-y-6">
      <section aria-labelledby="zen-conf" className="space-y-2 rounded border border-border p-4">
        <h3 id="zen-conf" className="font-semibold">Connection</h3>
        <p className="text-sm">Environment: <b>{c.environment ?? "not set"}</b> · Access token: <b>{c.tokenPresent ? "present on the server" : "missing"}</b> (never shown) · Status: <b>{c.configured ? "ready" : "not ready"}</b></p>
        {c.error && <p role="alert" className="text-sm text-destructive">{c.error.message}</p>}
        {!c.environment && <p className="text-sm">To use production: in Vercel → Settings → Environment Variables set <code className="break-words rounded bg-muted px-1">ZENODO_ENVIRONMENT</code> to <code className="rounded bg-muted px-1">production</code> (also <code className="break-words rounded bg-muted px-1">ZENODO_CLIENT_ID</code>, <code className="break-words rounded bg-muted px-1">ZENODO_CLIENT_SECRET</code>, <code className="break-words rounded bg-muted px-1">PUBLIC_SITE_URL</code>), then redeploy.</p>}
        {data.lastTest && <p className="text-sm text-muted-foreground">Last test {fmtDate(data.lastTest.at)}{data.lastTest.env ? ` (${data.lastTest.env})` : ""}: {data.lastTest.ok ? "connected" : "failed"}. {data.lastTest.message}</p>}
        <p className="text-sm text-muted-foreground">Sandbox test: {data.sandboxVerifiedAt ? fmtDate(data.sandboxVerifiedAt) : "not run (optional)"} · Production: {data.productionEnabled ? "enabled" : "off"}</p>
        {data.oauth && (
          <p className="text-sm text-muted-foreground">
            Zenodo sign-in: {data.oauth.connected ? <>connected{data.oauth.userName ? <> as <b>{data.oauth.userName}</b></> : null} on {fmtDate(data.oauth.connectedAt as string)}{data.oauth.envTokenSet ? " (a token set on the server is used instead)" : ""}</>
              : data.oauth.configured ? <>not connected{data.oauth.otherEnvironment ? ` (the saved connection belongs to ${data.oauth.otherEnvironment}; connect again for ${c.environment ?? "this environment"})` : ""}</>
              : <>not set up (add {data.oauth.missing.join(" and ")} on the server)</>}
          </p>
        )}
        {data.canAdmin ? (
          <div className="flex flex-wrap gap-2">
            {data.oauth?.configured && <Button disabled={busy === "connect" || !c.environment} onClick={() => run("connect", async () => { const r = await zenodoConnectUrl(); window.location.assign(r.url); }, "Opening Zenodo…")}>{data.oauth.connected ? "Reconnect Zenodo" : "Connect Zenodo"}</Button>}
            {data.oauth?.connected && <Button variant="outline" disabled={busy === "disconnect"} onClick={() => { if (window.confirm("Disconnect Zenodo? DOI registration stops until it is connected again.")) void run("disconnect", () => zenodoDisconnect(), "Zenodo disconnected"); }}>Disconnect</Button>}
            <Button variant="outline" disabled={busy === "test"} onClick={() => run("test", () => zenodoTestConnection().then((r) => { if (!r.ok) throw new Error(r.message); return r; }), "Connection works")}>Test connection</Button>
            <Button variant="outline" disabled={setProd.isPending} onClick={() => { if (!data.productionEnabled && !window.confirm("Enable production? DOIs registered on zenodo.org are permanent and cannot be deleted.")) return; setProd.mutate(!data.productionEnabled); }}>{data.productionEnabled ? "Switch production off" : "Enable production"}</Button>
          </div>
        ) : <p className="text-sm text-muted-foreground">Only administrators can test the connection or change configuration.</p>}
      </section>

      <section aria-labelledby="zen-wait" className="space-y-2">
        <h3 id="zen-wait" className="font-semibold">Accepted and awaiting publication approval ({data.awaitingApproval.length})</h3>
        {data.awaitingApproval.length === 0 && <p className="text-sm text-muted-foreground">Nothing is waiting.</p>}
        {data.awaitingApproval.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2">
            <span className="min-w-0 break-words text-sm"><b>{p.title}</b> <span className="text-muted-foreground">{p.paperly_id}</span></span>
            <Button disabled={busy === p.id} onClick={() => run(p.id, () => zenodoApprovePublication({ data: { paperId: p.id } }), "Approved. The DOI was registered and the article published.")}>Approve publication and register DOI</Button>
          </div>
        ))}
      </section>

      <section aria-labelledby="zen-rows" className="space-y-3">
        <h3 id="zen-rows" className="font-semibold">DOI registrations ({data.rows.length})</h3>
        {data.rows.map((r) => {
          const id = String(r.paper_id); const code = (r.last_error_code as string | null) ?? null;
          return (
            <article key={id} className="space-y-2 rounded border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><b className="break-words">{r.paper?.title ?? id}</b> <span className="text-sm text-muted-foreground">{r.paper?.paperly_id} · {r.paper?.status}</span></div>
                <span className={`rounded-full border px-3 py-0.5 text-sm ${r.workflow_status === "failed" ? "border-destructive text-destructive" : "border-border"}`}>{LABEL[String(r.workflow_status)] ?? String(r.workflow_status)} · {String(r.zenodo_environment ?? "")}</span>
              </div>
              {r.workflow_status === "registered" && r.doi && <div className="text-sm"><DoiLink doi={String(r.doi)} qr={false} /> <span className="text-muted-foreground">Registered {r.registered_at ? fmtDate(String(r.registered_at)) : ""}</span> · <a className="link" href={String(r.record_url)} target="_blank" rel="noopener noreferrer">Zenodo record</a></div>}
              {r.workflow_status !== "registered" && code && (
                <div role="alert" className="rounded-lg border border-destructive bg-critical-soft px-3 py-2 text-sm">
                  <p><b>{code}</b>: {String(r.last_error ?? "")}</p><p className="mt-1">{hint(code)}</p>
                  <p className="mt-1 text-muted-foreground">Attempts: {String(r.attempt_count)}{r.retryExhausted ? " · automatic retries finished; an administrator must retry" : r.next_retry_at ? ` · next automatic retry ${fmtDate(String(r.next_retry_at))}` : ""}. No DOI is shown publicly until Zenodo confirms one.</p>
                </div>
              )}
              {data.canAdmin && r.workflow_status !== "registered" && <Button variant="outline" disabled={busy === id} onClick={() => run(id, () => zenodoRetry({ data: { paperId: id } }), "Registered")}>Retry</Button>}
              {data.canAdmin && r.workflow_status === "registered" && <Button variant="outline" disabled={busy === id} onClick={() => run(id, () => zenodoUpdateMetadata({ data: { paperId: id } }), "Zenodo metadata updated (same DOI)")}>Update metadata on Zenodo</Button>}
            </article>
          );
        })}
      </section>
    </div>
  );
}
