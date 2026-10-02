import { createFileRoute, Link } from "@tanstack/react-router";
import { myPaperQuery, meQuery } from "@/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { retryScreening, startScreening } from "@/lib/app.functions";
import { AiMeter, type AiMeterData } from "@/components/ai-meter";
import { RazorpayPay } from "@/components/razorpay-checkout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, fmtDate, money } from "@/lib/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-research/$id")({
  head: () => ({ meta: [{ title: "Submission — Paperly" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context, params }) => { void context.queryClient.prefetchQuery(myPaperQuery(params.id)); void context.queryClient.prefetchQuery(meQuery()); },
  component: PaperReport,
});

const STAGES = ["Submitted", "Screening", "Decision", "Payment", "Published"] as const;
function stageIndex(s: string) {
  if (["DRAFT", "SUBMITTED"].includes(s)) return 0;
  if (["PROCESSING", "AI_SCREENING"].includes(s)) return 1;
  if (["REVIEW_REQUIRED", "REVISION_REQUIRED", "REJECTED", "ACCEPTED"].includes(s)) return 2;
  if (["PAYMENT_PENDING", "PAYMENT_COMPLETED", "PUBLICATION_PENDING"].includes(s)) return 3;
  return 4;
}

const CHECK_LABEL: Record<string, string> = {
  document: "Document integrity", authorship: "Authorship", copyright: "Copyright & permissions", similarity: "Similarity",
  citations: "References", methodology: "Methodology", statistics: "Statistics", ethics: "Research ethics",
  data_consistency: "Data consistency", figures: "Figures & tables", ai_content: "AI-generated text",
};
const STATUS_STYLE: Record<string, string> = {
  PASS: "bg-emerald-50 text-emerald-900 border-emerald-200", WARNING: "bg-amber-50 text-amber-900 border-amber-200",
  REVIEW_REQUIRED: "bg-amber-50 text-amber-900 border-amber-200", FAIL: "bg-red-50 text-red-900 border-red-200",
  NOT_APPLICABLE: "bg-muted text-muted-foreground border-border",
};
const STATUS_TEXT: Record<string, string> = { PASS: "Passed", WARNING: "Note", REVIEW_REQUIRED: "Needs review", FAIL: "Failed", NOT_APPLICABLE: "Not applicable" };

function PaperReport() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ ...myPaperQuery(id), refetchInterval: (q) => ["PROCESSING", "AI_SCREENING", "SUBMITTED"].includes(q.state.data?.paper.status ?? "") ? 4000 : false });
  const me = useQuery(meQuery());

  const started = useRef(false);
  useEffect(() => {
    if (data?.paper.status === "SUBMITTED" && !started.current) {
      started.current = true;
      void startScreening({ data: { id } }).finally(() => qc.invalidateQueries({ queryKey: ["my-paper", id] }));
    }
  }, [data?.paper.status, id, qc]);

  if (isLoading) return <div className="mx-auto max-w-4xl space-y-4 px-4 py-10"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (error || !data) return <div className="mx-auto max-w-4xl px-4 py-10"><p role="alert">This submission could not be found.</p><Link to="/my-research" className="underline">Back to my research</Link></div>;

  const { paper, screening, decisions, payments, authors, price, methods } = data;
  const stage = stageIndex(paper.status);
  const decision = decisions[0];
  const reasons = (Array.isArray(decision?.reasons) ? decision.reasons : []) as Array<{ code: string; outcome: string; message: string }>;
  const canPay = ["ACCEPTED", "PAYMENT_PENDING"].includes(paper.status);
  const meter = (screening?.aiMeter ?? null) as AiMeterData | null;
  const cites = (screening?.citations ?? null) as { checked: number; invalid: number; details: string[] } | null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Link to="/my-research" className="text-sm text-muted-foreground hover:text-foreground">← My research</Link>
      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="tabular-nums">{paper.public_id}</span><span aria-hidden="true" className="h-3 w-px bg-border" /><span>{paper.article_type}</span><span aria-hidden="true" className="h-3 w-px bg-border" /><span>Submitted {fmtDate(paper.created_at)}</span></div>
        <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight">{paper.title}</h1>
        <div className="mt-3 flex items-center gap-3"><StatusBadge status={paper.status} /><span className="text-sm text-muted-foreground">{authors.map((a) => a.full_name).join(", ")}</span></div>
      </header>

      <ol className="mt-8 grid grid-cols-5 gap-2" aria-label="Progress">
        {STAGES.map((s, i) => (
          <li key={s} aria-current={i === stage ? "step" : undefined}>
            <div className={cn("h-1 rounded-full", i < stage ? "bg-primary" : i === stage ? "bg-primary/60" : "bg-muted")} />
            <div className={cn("mt-2 text-xs", i <= stage ? "font-medium text-foreground" : "text-muted-foreground")}>{s}</div>
          </li>
        ))}
      </ol>

      {["PROCESSING", "AI_SCREENING", "SUBMITTED"].includes(paper.status) && (
        <div className="mt-6 rounded-lg border border-border bg-card p-5 text-sm" role="status">
          Screening is running. This page updates on its own; you can leave and come back.
          <Button variant="link" className="px-1" onClick={async () => { try { await retryScreening({ data: { id } }); qc.invalidateQueries({ queryKey: ["my-paper", id] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not restart screening"); } }}>Screening seems stuck?</Button>
        </div>
      )}

      {decision && (
        <section className="mt-8 rounded-lg border border-border bg-card">
          <header className="border-b border-border px-5 py-4"><h2 className="font-serif text-xl font-semibold">Decision</h2><p className="mt-0.5 text-sm text-muted-foreground">Made by policy {decision.policy_key} v{decision.policy_version} on {fmtDate(decision.created_at)}. AI supplies findings; the policy decides.</p></header>
          <div className="px-5 py-4">
            {reasons.length === 0 ? <p className="text-sm">All mandatory checks passed.</p> : (
              <ul className="space-y-3">{reasons.map((r, i) => <li key={i} className="text-sm"><span className="mr-2 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{r.outcome.replace("_", " ")}</span>{r.message}</li>)}</ul>
            )}
          </div>
        </section>
      )}

      {canPay && (
        <section className="mt-8 rounded-lg border border-primary/30 bg-card">
          <header className="border-b border-border px-5 py-4"><h2 className="font-serif text-xl font-semibold">Publish this work</h2><p className="mt-0.5 text-sm text-muted-foreground">Payment covers hosting and a permanent record. It does not influence the acceptance decision, which has already been made.</p></header>
          <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="font-serif text-3xl font-semibold tabular-nums">{price ? money(price.amountMinor, price.currency) : "—"}</div><div className="text-sm text-muted-foreground">UPI, Visa, Mastercard, RuPay and netbanking via Razorpay. Card details never reach Paperly.</div></div>
            {methods.RAZORPAY && price
              ? <RazorpayPay paperId={paper.id} amountMinor={price.amountMinor} currency={price.currency} email={me.data?.profile?.email} name={me.data?.profile?.display_name} onPaid={() => qc.invalidateQueries({ queryKey: ["my-paper", id] })} />
              : <p className="text-sm text-muted-foreground">Online payment is being set up. You will be notified when it opens.</p>}
          </div>
        </section>
      )}

      {screening && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl font-semibold">Screening report</h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
            {screening.findings.map((f) => (
              <li key={f.check_key} className="flex items-start justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0"><div className="text-sm font-medium">{CHECK_LABEL[f.check_key] ?? f.check_key}</div><p className="mt-0.5 text-sm text-muted-foreground">{f.message}</p></div>
                <span className={cn("shrink-0 rounded border px-2 py-0.5 text-xs", STATUS_STYLE[f.status])}>{STATUS_TEXT[f.status] ?? f.status}</span>
              </li>
            ))}
            {screening.findings.length === 0 && <li className="px-5 py-4 text-sm text-muted-foreground">No AI findings are on file for this submission (AI processing was not consented to, or it did not complete).</li>}
          </ul>
          {cites && (
            <p className="mt-3 text-sm text-muted-foreground">References: {cites.checked} DOIs checked against Crossref, {cites.invalid} could not be resolved.{cites.details.length > 0 && <> <span className="text-foreground">{cites.details.slice(0, 3).join("; ")}{cites.details.length > 3 ? "…" : ""}</span></>}</p>
          )}
          {meter && <AiMeter meter={meter} className="mt-6" />}
        </section>
      )}

      {payments.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl font-semibold">Payments</h2>
          <table className="mt-4 w-full text-sm"><thead><tr className="border-b border-border text-left text-[13px] text-muted-foreground"><th className="py-2 font-medium">Order</th><th className="font-medium">Amount</th><th className="font-medium">Status</th><th className="text-right font-medium">Date</th></tr></thead>
            <tbody>{payments.map((p) => <tr key={p.order_id} className="border-b border-border"><td className="py-2.5 tabular-nums">{p.order_id}</td><td className="tabular-nums">{money(p.amount_minor, p.currency)}</td><td><StatusBadge status={p.status} /></td><td className="text-right">{fmtDate(p.completed_at ?? p.created_at)}</td></tr>)}</tbody></table>
        </section>
      )}
    </div>
  );
}
