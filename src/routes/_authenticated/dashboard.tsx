import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { myDashboard } from "@/lib/scholarly.functions";
import { PageTitle, StatusBadge, fmtDate } from "@/lib/ui";
import { STATUS_LABEL } from "@/lib/domain/constants";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Dashboard | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Dashboard,
});

type To = "/admin" | "/reviews" | "/certificates" | "/my-research";
const Stat = ({ label, value, to }: { label: string; value: React.ReactNode; to: To }) => (
  <Link to={to} className="block rounded-xl border border-border bg-card p-4 no-underline shadow-sm transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-lift">
    <span className="block text-[1.75rem] font-semibold leading-none tabular-nums">{value}</span>
    <span className="mt-1 block text-sm text-muted-foreground">{label}</span>
  </Link>
);
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-4 mt-12 border-b border-border pb-2 text-[1.375rem]">{children}</h2>;

function Dashboard() {
  const { data: d, isLoading, isError } = useQuery({ queryKey: ["dashboard"], queryFn: () => myDashboard(), staleTime: 0, refetchOnMount: "always" });
  if (isLoading) return <div className="mx-auto max-w-5xl px-5 pt-10 text-muted-foreground">Loading…</div>;
  if (isError || !d) return <div className="mx-auto max-w-5xl px-5 pt-10">The dashboard could not be loaded. Refresh to try again.</div>;
  return (
    <div className="mx-auto max-w-5xl px-5 pt-10">
      <PageTitle title="Dashboard" subtitle="What needs your attention, by role." />

      <H>As an author</H>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="In progress" value={d.author.submissions.length} to="/my-research" />
        <Stat label="Revisions requested" value={d.author.revisionsRequested.length} to="/my-research" />
        <Stat label="Awaiting payment" value={d.author.awaitingPayment.length} to="/my-research" />
        <Stat label="Certificates" value={d.author.certificates} to="/certificates" />
      </div>
      {d.author.submissions.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-y border-border text-[15px]">
          {d.author.submissions.slice(0, 8).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <Link to="/my-research/$id" params={{ id: p.id }} className="link">{p.title || "Untitled"}</Link>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      )}
      {d.author.published.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">Published</h3>
          <ul className="mt-2 divide-y divide-border border-y border-border text-[15px]">
            {d.author.published.map((p) => (
              <li key={p.paperly_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link to="/article/$paperlyId" params={{ paperlyId: p.paperly_id }} className="link">{p.title}</Link>
                <span className="text-sm text-muted-foreground">{p.doi ? `DOI ${p.doi}` : "No DOI registered"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.author.payments.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">Payments</h3>
          <ul className="mt-2 divide-y divide-border border-y border-border text-[15px]">
            {d.author.payments.map((p) => (
              <li key={p.order_id} className="flex flex-wrap justify-between gap-2 py-2.5">
                <span className="tabular-nums">{p.order_id}</span>
                <span>{(p.amount_minor / 100).toFixed(2)} {p.currency} · {p.status} · {fmtDate(p.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {d.reviewer && (
        <>
          <H>As a reviewer</H>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Invitations" value={d.reviewer.invitations} to="/reviews" />
            <Stat label="Active reviews" value={d.reviewer.active} to="/reviews" />
            <Stat label="Completed" value={d.reviewer.completed} to="/reviews" />
            <Stat label="Overdue" value={d.reviewer.overdue} to="/reviews" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Next deadline: {d.reviewer.nextDue ? fmtDate(d.reviewer.nextDue) : "none set"}.</p>
        </>
      )}

      {d.editor && (
        <>
          <H>As an editor</H>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(d.editor).map(([s, n]) => (
              <Stat key={s} label={(STATUS_LABEL as Record<string, string>)[s] ?? s} value={n} to="/admin" />
            ))}
          </div>
        </>
      )}

      {d.admin && (
        <>
          <H>As an administrator</H>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Registered users" value={d.admin.users} to="/admin" />
            <Stat label="Board entries awaiting confirmation" value={d.admin.boardUnconfirmed} to="/admin" />
            <Stat label="Payments in progress" value={d.admin.pendingPayments} to="/admin" />
            <Stat label="Audit events, last 24 h" value={d.admin.auditLast24h} to="/admin" />
          </div>
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-[15px] sm:grid-cols-[16rem_1fr]">
            <dt className="text-muted-foreground">Journal mode</dt><dd>{d.admin.journalMode ? "On: journal articles go through peer review" : "Off: repository only"}</dd>
            <dt className="text-muted-foreground">Online payments</dt><dd>{d.admin.paymentsOpen ? "Open" : "Not configured"}</dd>
            <dt className="text-muted-foreground">DOI provider</dt><dd>{d.admin.doiProvider === "none" ? "None configured: no DOIs are registered" : d.admin.doiProvider}</dd>
            <dt className="text-muted-foreground">ISSN</dt><dd>{d.admin.issnConfirmed ? "Confirmed and public" : "None assigned"}</dd>
          </dl>
        </>
      )}
    </div>
  );
}
