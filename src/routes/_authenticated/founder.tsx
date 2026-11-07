import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getFounderSummary, getFounderTransactions, getFounderSharedPayments, getFounderHold, getFounderUserNames } from "@/lib/founder.functions";
import { meQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageTitle, fmtDate, money, PageLoading } from "@/lib/ui";

export const Route = createFileRoute("/_authenticated/founder")({
  head: () => ({ meta: [{ title: "Payments | Paperly" }, { name: "robots", content: "noindex" }] }),
  component: Founder,
});

const STATUSES = ["", "PAID", "PENDING", "PROCESSING", "FAILED", "REFUNDED", "CANCELLED"];
const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="surface surface-interactive min-w-0 p-4"><span className="block truncate text-[1.5rem] font-semibold leading-none tabular-nums">{value}</span><span className="mt-1 block text-sm text-muted-foreground">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</div>
);
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-4 mt-12 border-b border-border pb-2 text-[1.375rem]">{children}</h2>;

const Note = ({ children }: { children: React.ReactNode }) => <p className="border-y border-border py-6 text-muted-foreground">{children}</p>;

function Founder() {
  const hold = useQuery({ queryKey: ["founder-hold"], queryFn: () => getFounderHold(), retry: false, staleTime: 15_000 });
  const blocked = hold.data?.onHold === true || hold.isError;
  const s = useQuery({ queryKey: ["founder-summary"], queryFn: () => getFounderSummary(), enabled: !blocked && !hold.isLoading, retry: false, staleTime: 30_000 });
  const me = useQuery({ ...meQuery(), staleTime: 60_000 });
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [spage, setSpage] = useState(1); const [upage, setUpage] = useState(1);
  // Known from the roles already in the header, so the list loads at the same time as the totals instead of after them.
  const canMoney = (me.data?.roles ?? []).some((r) => r === "admin" || r === "super_admin");
  const t = useQuery({ queryKey: ["founder-tx", status, page], queryFn: () => getFounderTransactions({ data: { ...(status ? { status } : {}), page } }), retry: false, staleTime: 30_000, enabled: canMoney && !blocked, placeholderData: (prev) => prev });
  const sp = useQuery({ queryKey: ["founder-shared", spage], queryFn: () => getFounderSharedPayments({ data: { page: spage } }), retry: false, staleTime: 30_000, placeholderData: (prev) => prev, enabled: !blocked && !hold.isLoading });
  const un = useQuery({ queryKey: ["founder-users", upage], queryFn: () => getFounderUserNames({ data: { page: upage } }), retry: false, staleTime: 30_000, placeholderData: (prev) => prev, enabled: !blocked && !hold.isLoading && !canMoney });
  if (hold.isLoading) return <PageLoading />;
  if (hold.data?.onHold || hold.isError) return (
    <div className="content-enter mx-auto w-full max-w-2xl px-4 pb-16 pt-10 sm:px-5">
      <PageTitle title="Payments" />
      <div role="alert" className="mt-6 space-y-3 border border-destructive/40 bg-destructive/5 p-5">
        <p className="text-lg font-semibold">Access is on hold: please clear your dues first</p>
        <p className="text-muted-foreground">Your payments and founder access are blocked until the dues on your account are cleared. Once an administrator confirms they are cleared, everything comes back automatically.</p>
        {hold.data?.onHold && hold.data.note && <p className="border-l-2 border-border pl-3 text-sm">{hold.data.note}</p>}
        <p className="text-sm text-muted-foreground">Please contact an administrator to clear your dues.</p>
      </div>
    </div>
  );
  if (s.isLoading) return <PageLoading />;
  if (s.isError || !s.data) return <div role="alert" className="mx-auto max-w-5xl px-5 pt-10">{s.error instanceof Error && /dues are pending/i.test(s.error.message) ? s.error.message : s.error instanceof Error && /forbidden/i.test(s.error.message) ? "This page is only for founders and administrators." : "The founder view could not be loaded. Refresh to try again."}</div>;
  const { people, money: m } = s.data;
  const rows = t.data?.rows ?? [];
  // A column appears only if at least one row has something in it.
  const paidHint = m ? [m.statusCounts["PENDING"] ? `${m.statusCounts["PENDING"]} pending` : "", m.statusCounts["FAILED"] ? `${m.statusCounts["FAILED"]} failed` : ""].filter(Boolean).join(" · ") : "";
  const showMethod = rows.some((p) => !!p.provider);
  return (
    <div className="content-enter mx-auto w-full min-w-0 max-w-5xl overflow-x-clip px-4 pb-16 pt-10 sm:px-5">
      <PageTitle title="Payments" />
      {(people || m) && (
        <>
          <H>Overview</H>
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
            {people && <Stat label="Registered users" value={people.users} />}
            {people && <Stat label="New in the last 30 days" value={people.newUsers30d} />}
            {m && <Stat label="Transactions" value={m.transactions} />}
            {m && <Stat label="Paid" value={m.statusCounts["PAID"] ?? 0} {...(paidHint ? { hint: paidHint } : {})} />}
          </div>
        </>
      )}
      {!m && sp.data && (
        <>
          <H>Payments</H>
          {sp.data.total === 0 ? <Note>No payments to show yet.</Note> : (
            <>
              <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sp.data.totals.map((c) => <Stat key={c.currency} label={`Shown as received in ${c.currency} (${c.paidCount} paid)`} value={money(c.paid, c.currency)} />)}
              </div>
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {sp.data.rows.map((p) => (
                  <li key={p.order_id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-3 text-sm">
                    <span className="min-w-0 truncate font-mono text-xs" title={p.order_id}>{p.order_id}</span>
                    <span className="text-right font-semibold tabular-nums">{money(p.amount_minor, p.currency)}</span>
                    <span className="text-muted-foreground">{fmtDate(p.created_at)}</span>
                    <span className="text-right text-muted-foreground">{p.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
              {sp.data.total > sp.data.pageSize && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>{sp.data.total} payments</span><span className="flex gap-2"><Button size="sm" variant="outline" disabled={spage <= 1} onClick={() => setSpage(spage - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={spage * sp.data.pageSize >= sp.data.total} onClick={() => setSpage(spage + 1)}>Next</Button></span></div>}
            </>
          )}
        </>
      )}
      {!m && un.data && (
        <>
          <H>Users</H>
          <p className="text-sm text-muted-foreground">{un.data.total} registered user{un.data.total === 1 ? "" : "s"}. Names only.</p>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {un.data.names.map((n, i) => <li key={`${upage}-${i}`} className="truncate py-2 text-sm">{n}</li>)}
          </ul>
          {un.data.total > un.data.pageSize && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>{un.data.total} users</span><span className="flex gap-2"><Button size="sm" variant="outline" disabled={upage <= 1} onClick={() => setUpage(upage - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={upage * un.data.pageSize >= un.data.total} onClick={() => setUpage(upage + 1)}>Next</Button></span></div>}
        </>
      )}
      {m && (
        <>
          <H>Money</H>
          {m.currencies.length === 0 ? <Note>No payments have been recorded yet.</Note> : (
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {m.currencies.map((c) => <Stat key={c.currency} label={`Received in ${c.currency} (${c.paidCount} paid)`} value={money(c.paid, c.currency)} {...(c.refundedCount ? { hint: `${money(c.refunded, c.currency)} refunded in ${c.refundedCount} payment${c.refundedCount === 1 ? "" : "s"}` } : {})} />)}
            </div>
          )}
          {m.truncated && <p className="mt-2 text-xs text-muted-foreground">Totals cover the most recent 10,000 payments.</p>}

          <H>Transactions</H>
          {m.transactions > 0 && <label className="text-sm font-medium">Status<select className="ml-2 h-10 rounded-lg border border-input bg-background px-2" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{STATUSES.map((x) => <option key={x} value={x}>{x ? x.toLowerCase() : "all"}</option>)}</select></label>}
          {t.isLoading && <div role="status" aria-label="Loading transactions" className="mt-3 space-y-2"><Skeleton className="h-12 rounded-lg" /><Skeleton className="h-12 rounded-lg" /><Skeleton className="h-12 rounded-lg" /></div>}
          {t.isError && <p role="alert" className="mt-3 text-destructive">Transactions could not be loaded. Refresh to try again.</p>}
          {t.isSuccess && rows.length === 0 && <Note>{m.transactions === 0 ? "No transactions yet." : "No transactions match."}</Note>}
          {rows.length > 0 && (
            <>
              {/* Phones: one stacked card per transaction, so nothing is cut off or scrolls sideways. */}
              <ul className="stagger mt-3 divide-y divide-border border-y border-border sm:hidden">
                {rows.map((p) => (
                  <li key={p.order_id} className="min-w-0 py-3">
                    <div className="flex items-baseline justify-between gap-3"><span className="font-semibold tabular-nums">{money(p.amount_minor, p.currency)}</span><span className="text-sm text-muted-foreground">{p.status.toLowerCase()}</span></div>
                    <div className="mt-1 break-words text-sm">{p.email}</div>
                    <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span>{fmtDate(p.created_at)}{showMethod && p.provider ? ` · ${p.provider.toLowerCase()}` : ""}</span><span className="break-words font-mono">{p.order_id}</span></div>
                  </li>
                ))}
              </ul>
              {/* Wider screens: a fixed-layout table. Column widths add up to 100%, long values are cut with an ellipsis. */}
              <table className="mt-3 hidden w-full table-fixed text-left text-sm sm:table">
                <colgroup><col className="w-[15%]" /><col className="w-[22%]" /><col className={showMethod ? "w-[25%]" : "w-[33%]"} /><col className="w-[16%]" />{showMethod && <col className="w-[10%]" />}<col className={showMethod ? "w-[12%]" : "w-[14%]"} /></colgroup>
                <thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-3 font-medium">Date</th><th className="pr-3 font-medium">Order</th><th className="pr-3 font-medium">User</th><th className="pr-3 text-right font-medium">Amount</th>{showMethod && <th className="pr-3 font-medium">Method</th>}<th className="font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map((p) => (
                    <tr key={p.order_id} className="row-hover align-top"><td className="truncate py-2 pr-3">{fmtDate(p.created_at)}</td><td className="truncate pr-3 font-mono text-xs leading-5" title={p.order_id}>{p.order_id}</td><td className="truncate pr-3" title={p.email}>{p.email}</td><td className="truncate pr-3 text-right tabular-nums">{money(p.amount_minor, p.currency)}</td>{showMethod && <td className="truncate pr-3">{p.provider ? p.provider.toLowerCase() : ""}</td>}<td className="truncate">{p.status.toLowerCase()}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {t.data && t.data.total > t.data.pageSize && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>{t.data.total} transaction{t.data.total === 1 ? "" : "s"}</span><span className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * t.data.pageSize >= t.data.total} onClick={() => setPage(page + 1)}>Next</Button></span></div>}
        </>
      )}
    </div>
  );
}
