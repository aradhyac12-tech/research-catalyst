import { createFileRoute } from "@tanstack/react-router";
import { adminQuery } from "@/lib/queries";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminPaperReport, adminDecide } from "@/lib/app.functions";
import { AiMeter, type AiMeterData } from "@/components/ai-meter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageTitle, StatusBadge, fmtDate, money } from "@/lib/ui";
import { STATUS_LABEL } from "@/lib/domain/constants";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Editorial — Paperly" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => { void context.queryClient.prefetchQuery(adminQuery()); },
  component: Admin,
});

function Admin() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, isLoading } = useQuery(adminQuery());
  if (isLoading) return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-muted-foreground">Loading…</div>;
  if (error || !data) return <div className="mx-auto max-w-5xl px-4 py-10"><PageTitle title="Editorial" /><p role="alert" className="text-sm">You do not have access to this area.</p></div>;
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageTitle title="Editorial" subtitle="Papers awaiting a human decision, and platform activity." />
      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(data.byStatus).map(([s, n]) => <div key={s} className="rounded-lg border border-border bg-card px-4 py-3"><dt className="text-xs text-muted-foreground">{STATUS_LABEL[s] ?? s}</dt><dd className="font-serif text-2xl font-semibold tabular-nums">{n}</dd></div>)}
      </dl>
      <h2 className="font-serif text-xl font-semibold">Queue</h2>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card empty:hidden">
        {data.queue.map((p) => (
          <li key={p.id}>
            <button className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/50" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
              <div className="min-w-0"><div className="text-xs text-muted-foreground">{p.public_id}, {p.article_type}, {fmtDate(p.created_at)}</div><div className="truncate font-serif text-lg font-semibold">{p.title}</div></div>
              <StatusBadge status={p.status} />
            </button>
            {open === p.id && <Review id={p.id} canDecide={p.status === "REVIEW_REQUIRED"} onDone={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["admin"] }); }} />}
          </li>
        ))}
      </ul>
      {data.queue.length === 0 && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing is waiting for review.</p>}
      <h2 className="mt-10 font-serif text-xl font-semibold">Recent payments</h2>
      <table className="mt-3 w-full text-sm"><thead><tr className="border-b border-border text-left text-[13px] text-muted-foreground"><th className="py-2 font-medium">Order</th><th className="font-medium">Amount</th><th className="font-medium">Method</th><th className="font-medium">Status</th><th className="text-right font-medium">Date</th></tr></thead>
        <tbody>{data.payments.map((p) => <tr key={p.order_id} className="border-b border-border"><td className="py-2.5 tabular-nums">{p.order_id}</td><td className="tabular-nums">{money(p.amount_minor, p.currency)}</td><td>{p.method}</td><td><StatusBadge status={p.status} /></td><td className="text-right">{fmtDate(p.created_at)}</td></tr>)}</tbody></table>
    </div>
  );
}

function Review({ id, canDecide, onDone }: { id: string; canDecide: boolean; onDone: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["admin-paper", id], queryFn: () => adminPaperReport({ data: { id } }) });
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  async function decide(outcome: "ACCEPT" | "REJECT" | "REVISION_REQUIRED") {
    if (reason.trim().length < 10) { toast.error("Give a reason of at least 10 characters. The author will see it."); return; }
    setBusy(true);
    try { await adminDecide({ data: { paperId: id, outcome, reason } }); toast.success("Decision recorded"); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not record decision"); } finally { setBusy(false); }
  }
  if (isLoading || !data) return <div className="px-5 pb-5 text-sm text-muted-foreground">Loading report…</div>;
  const meter = data.aiMeter as AiMeterData | null;
  return (
    <div className="space-y-5 border-t border-border bg-muted/20 px-5 py-5">
      <p className="text-sm leading-relaxed">{data.paper.abstract}</p>
      {data.run && <p className="text-xs text-muted-foreground">Screened by {data.run.model} under {data.run.policy}.</p>}
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {data.findings.map((f) => (
          <li key={f.check_key} className="px-4 py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{f.check_key.replace("_", " ")}</span><span className="text-xs text-muted-foreground">{f.status.replace("_", " ")}, {f.severity}</span></div><p className="mt-1 text-muted-foreground">{f.message}</p>
            {f.evidence.filter((e) => e.quote).slice(0, 2).map((e, i) => <blockquote key={i} className="mt-2 border-l-2 border-border pl-3 text-xs italic text-muted-foreground">“{e.quote}”{e.section ? ` — ${e.section}` : ""}</blockquote>)}</li>
        ))}
      </ul>
      {meter && <AiMeter meter={meter} />}
      {canDecide && (
        <div className="space-y-3">
          <Textarea rows={3} placeholder="Reason for your decision (visible to the author)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => decide("ACCEPT")}>Accept</Button><Button disabled={busy} variant="outline" onClick={() => decide("REVISION_REQUIRED")}>Request revision</Button><Button disabled={busy} variant="destructive" onClick={() => decide("REJECT")}>Reject</Button></div>
        </div>
      )}
    </div>
  );
}
