import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getFounderSummary, getFounderTransactions } from "@/lib/founder.functions";
import { RoleManager } from "@/components/role-manager";
import { FeeWaivers } from "@/components/fee-waivers";
import { Button } from "@/components/ui/button";
import { PageTitle, fmtDate, money } from "@/lib/ui";

export const Route = createFileRoute("/_authenticated/founder")({
  head: () => ({ meta: [{ title: "Founder view | Paperly" }, { name: "robots", content: "noindex" }] }),
  component: Founder,
});

const STATUSES = ["", "PAID", "PENDING", "PROCESSING", "FAILED", "REFUNDED", "CANCELLED"];
const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><span className="block text-[1.5rem] font-semibold leading-none tabular-nums">{value}</span><span className="mt-1 block text-sm text-muted-foreground">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</div>
);
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-4 mt-12 border-b border-border pb-2 text-[1.375rem]">{children}</h2>;

function Founder() {
  const s = useQuery({ queryKey: ["founder-summary"], queryFn: () => getFounderSummary(), retry: false, staleTime: 0 });
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const t = useQuery({ queryKey: ["founder-tx", status, page], queryFn: () => getFounderTransactions({ data: { ...(status ? { status } : {}), page } }), retry: false, staleTime: 0, enabled: s.isSuccess });
  if (s.isLoading) return <div className="mx-auto max-w-5xl px-5 pt-10 text-muted-foreground">Loading…</div>;
  if (s.isError || !s.data) return <div role="alert" className="mx-auto max-w-5xl px-5 pt-10">{s.error instanceof Error && /forbidden/i.test(s.error.message) ? "This page is only for founders and administrators." : "The founder view could not be loaded. Refresh to try again."}</div>;
  const d = s.data;
  return (
    <div className="mx-auto max-w-5xl px-5 pb-16 pt-10">
      <PageTitle title="Founder view" subtitle="People, money and transactions. Read only, apart from allowing editors and reviewers." />
      <H>Overview</H>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Registered users" value={d.users} />
        <Stat label="New in the last 30 days" value={d.newUsers30d} />
        <Stat label="Transactions" value={d.transactions} />
        <Stat label="Paid" value={d.statusCounts["PAID"] ?? 0} hint={`${d.statusCounts["PENDING"] ?? 0} pending · ${d.statusCounts["FAILED"] ?? 0} failed`} />
      </div>
      <H>Money</H>
      {d.currencies.length === 0 ? <p className="border-y border-border py-6 text-muted-foreground">No payments have been recorded yet.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.currencies.map((c) => <Stat key={c.currency} label={`Received in ${c.currency} (${c.paidCount} paid)`} value={money(c.paid, c.currency)} hint={c.refundedCount ? `${money(c.refunded, c.currency)} refunded in ${c.refundedCount} payment${c.refundedCount === 1 ? "" : "s"}` : "No refunds"} />)}
        </div>
      )}
      {d.truncated && <p className="mt-2 text-xs text-muted-foreground">Totals cover the most recent 10,000 payments.</p>}

      <H>Transactions</H>
      <label className="text-sm font-medium">Status<select className="ml-2 h-10 rounded-[2px] border border-input bg-background px-2" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{STATUSES.map((x) => <option key={x} value={x}>{x ? x.toLowerCase() : "all"}</option>)}</select></label>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-3 font-medium">Date</th><th className="pr-3 font-medium">Order</th><th className="pr-3 font-medium">User</th><th className="pr-3 text-right font-medium">Amount</th><th className="pr-3 font-medium">Method</th><th className="font-medium">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {(t.data?.rows ?? []).map((p) => (
              <tr key={p.order_id}><td className="py-2 pr-3 whitespace-nowrap">{fmtDate(p.created_at)}</td><td className="pr-3 font-mono text-xs">{p.order_id}</td><td className="max-w-[14rem] truncate pr-3">{p.email}</td><td className="pr-3 text-right tabular-nums">{money(p.amount_minor, p.currency)}</td><td className="pr-3">{p.provider.toLowerCase()}</td><td>{p.status.toLowerCase()}</td></tr>
            ))}
          </tbody>
        </table>
        {t.isSuccess && t.data.rows.length === 0 && <p className="border-y border-border py-6 text-muted-foreground">No transactions match.</p>}
      </div>
      {t.data && <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>{t.data.total} transaction{t.data.total === 1 ? "" : "s"}</span><span className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * t.data.pageSize >= t.data.total} onClick={() => setPage(page + 1)}>Next</Button></span></div>}

      <div className="mt-12"><RoleManager /></div>
      <div className="mt-12"><FeeWaivers /></div>
    </div>
  );
}
