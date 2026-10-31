import { MANUSCRIPT_ACCEPT } from "@/lib/domain/file-security";
import { createFileRoute, Link } from "@tanstack/react-router";
import { adminQuery } from "@/lib/queries";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminTestOverview, adminTestPayment, adminTestPaywall, adminTestCertificate, adminTestPublish, adminTestPayments, adminPaperReport, adminPublish, adminPublishWaiting, adminListPromoCodes, adminCreatePromoCode, adminGetPublicationFees, adminSetPublicationFee, adminSetPromoCodeActive, adminListFailedRefunds, adminRetryRefund } from "@/lib/app.functions";
import { adminGetSettings, adminUpdateSettings, adminApproveWithoutReview, editorApproveRequest, editorCloseReviews, editorDecide, editorDeclineRequest, editorExtendDeadline, editorInviteReviewer, editorListReviewers, editorReplaceReviewer, editorReviews, editorSetOpenClaims, editorSetPublicationType, editorStartPeerReview } from "@/lib/review.functions";
import { adminAuditLog, adminConfirmBoardMember, adminDeleteBoardMember, adminGetIdentity, adminListBoard, adminSaveBoardMember, adminSaveIdentity } from "@/lib/identity.functions";
import { adminIssueNotice, myPaperReferences, validatePaperReferences } from "@/lib/scholarly.functions";
import { adminIssueCorrectedVersion } from "@/lib/versions.functions";
import { appendFile } from "@/lib/stage-upload";
import { REFERENCE_STATUS_LABEL, type ReferenceStatus } from "@/lib/domain/references";
import { ZenodoAdmin } from "@/components/zenodo-admin";
import { RoleManager } from "@/components/role-manager";
import { AdminEmail } from "@/components/admin-email";
import { FeeWaivers } from "@/components/fee-waivers";
import { BannerAdmin } from "@/components/banner-admin";
import { RemoveArticles, DeleteResearchButton } from "@/components/remove-articles";
import { REVIEW_MODEL_LABEL } from "@/lib/domain/review";
import { AiMeter, type AiMeterData } from "@/components/ai-meter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PageTitle, StatusBadge, fmtDate, money, PageLoading } from "@/lib/ui";
import { STATUS_LABEL } from "@/lib/domain/constants";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Editorial | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Editorial | Paperly" }, { property: "og:type", content: "website" }] }),
  loader: ({ context }) => { void context.queryClient.prefetchQuery(adminQuery()); },
  component: Admin,
});

type PageId = "review" | "research" | "notices" | "payments" | "pricing" | "waivers" | "banners" | "users" | "email" | "activity" | "settings" | "identity" | "doi" | "tools";
type GroupId = "editorial" | "money" | "people" | "journal";
type Item = { id: PageId; label: string; any: string[] };
type Group = { id: GroupId; label: string; blurb: string; items: Item[] };
// Related sections live together: one page per area, with its sections as tabs on that page. Each section lists the permissions that
// unlock it (any one is enough). Sections (and whole areas) the person cannot use are not drawn at all.
const GROUPS: Group[] = [
  { id: "editorial", label: "Editorial", blurb: "Review submissions, find any record, and issue notices", items: [{ id: "review", label: "Review queue", any: ["EDITORIAL_REVIEW"] }, { id: "research", label: "All research", any: ["EDITORIAL_REVIEW"] }, { id: "notices", label: "Corrections", any: ["EDITORIAL_REVIEW"] }] },
  { id: "money", label: "Money", blurb: "Payments, fees, promo codes, waivers and banners", items: [{ id: "payments", label: "Payments", any: ["PAYMENT_MANAGE"] }, { id: "pricing", label: "Fees and promos", any: ["PAYMENT_MANAGE"] }, { id: "waivers", label: "Fee waivers", any: ["PAYMENT_MANAGE"] }, { id: "banners", label: "Banners", any: ["SYSTEM_ADMIN"] }] },
  { id: "people", label: "People", blurb: "Roles, e-mail to users or anyone, and the activity log", items: [{ id: "users", label: "Users and roles", any: ["SYSTEM_ADMIN"] }, { id: "email", label: "E-mail someone", any: ["SYSTEM_ADMIN"] }, { id: "activity", label: "Activity log", any: ["AUDIT_READ"] }] },
  { id: "journal", label: "Journal", blurb: "Publication settings, identity, DOI and test tools", items: [{ id: "settings", label: "Settings", any: ["SYSTEM_ADMIN"] }, { id: "identity", label: "Identity and board", any: ["SYSTEM_ADMIN"] }, { id: "doi", label: "DOI (Zenodo)", any: ["EDITORIAL_REVIEW", "PUBLICATION_MANAGE"] }, { id: "tools", label: "Test tools", any: ["SYSTEM_ADMIN"] }] },
];
const LABEL: Record<string, string> = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])));
const GROUP_OF: Record<string, GroupId> = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, g.id])));

/** The address holds the area and the section: #money/payments. A bare section (#payments, an older link) or a bare area (#money) still works. */
function parseHash(raw: string, allowed: PageId[]): PageId | undefined {
  const [a, b] = raw.replace(/^#/, "").split("/");
  if (b && allowed.includes(b as PageId)) return b as PageId;
  if (a && allowed.includes(a as PageId)) return a as PageId;
  const g = GROUPS.find((x) => x.id === a);
  return g?.items.find((i) => allowed.includes(i.id))?.id;
}

function Admin() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState<PageId>("review");
  // Sections already opened stay mounted (just hidden), so going back to one is instant and keeps what was typed.
  const [visited, setVisited] = useState<PageId[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const { data, error, isLoading } = useQuery(adminQuery());
  const perms = new Set<string>(data?.permissions ?? []);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.any.some((p) => perms.has(p))) })).filter((g) => g.items.length > 0);
  const allowedIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const choose = (id: PageId) => { setPage(id); setVisited((v) => (v.includes(id) ? v : [...v, id])); };
  useEffect(() => {
    if (!data) return;
    const ids = GROUPS.flatMap((g) => g.items).filter((i) => i.any.some((p) => (data.permissions ?? []).includes(p))).map((i) => i.id);
    const first = parseHash(window.location.hash, ids) ?? ids[0] ?? "review";
    choose(first);
    const onHash = () => { const n = parseHash(window.location.hash, ids); if (n) choose(n); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [data]);
  const go = (id: PageId) => {
    const changedArea = GROUP_OF[id] !== GROUP_OF[page];
    choose(id);
    window.history.replaceState(null, "", `#${GROUP_OF[id]}/${id}`);
    // Instant, never animated: a smooth scroll would make every click feel slow.
    if (changedArea) window.scrollTo({ top: 0, behavior: "instant" });
    else { const el = body.current; if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: "instant" }); }
  };
  if (isLoading) return <PageLoading />;
  if (error || !data) return <div className="mx-auto max-w-5xl px-5 pt-10"><PageTitle title="Editorial" /><p role="alert" className="rounded-lg border border-destructive bg-critical-soft px-4 py-3">Your account cannot access this panel.</p></div>;
  const shown: PageId | undefined = allowedIds.includes(page) ? page : allowedIds[0];
  const activeGroup = groups.find((g) => g.items.some((i) => i.id === shown));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["admin"] }); };

  const panel = (id: PageId): React.ReactNode => {
    switch (id) {
      case "review": return (
        <>
          <PublishWaitingBanner count={data.queue.filter((p) => p.status === "PUBLICATION_PENDING").length} onDone={refresh} />
          <Section title="Editorial queue" meta={`${data.queue.length} paper${data.queue.length === 1 ? "" : "s"}`}>
            <ul className="divide-y divide-border empty:hidden">
              {data.queue.map((p) => (
                <li key={p.id} className="min-w-0">
                  <button type="button" className="row-hover flex w-full min-w-0 items-center justify-between gap-3 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-5" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <div className="min-w-0"><div className="break-words text-sm text-muted-foreground">{p.public_id}, {p.article_type}, submitted {fmtDate(p.created_at)}</div><div className="mt-1 break-words font-serif text-[1.125rem] leading-snug">{p.title}</div></div>
                    <StatusBadge status={p.status} />
                  </button>
                  {open === p.id && <div className="min-w-0 px-4 pb-4 sm:px-5"><Review id={p.id} status={p.status} canDecide={["REVIEW_REQUIRED", "EDITORIAL_DECISION"].includes(p.status)} canPublish={p.status === "PUBLICATION_PENDING"} onDone={() => { void qc.invalidateQueries({ queryKey: ["admin"] }); void qc.invalidateQueries({ queryKey: ["admin-paper", p.id] }); }} onClose={() => setOpen(null)} /></div>}
                </li>
              ))}
            </ul>
            {data.queue.length === 0 && <p className="px-5 py-10 text-center text-muted-foreground">Nothing is waiting for review.</p>}
          </Section>
        </>
      );
      case "research": return <div className="min-w-0"><RemoveArticles /></div>;
      case "notices": return <Quiet><NoticePanel /></Quiet>;
      case "payments": return (
        <>
          <FailedRefunds />
          <Section title="Recent payments">
            <div className="min-w-0 max-w-full px-4 py-2 sm:px-5">
              <ul className="divide-y divide-border">
                {data.payments.map((p) => (
                  <li key={p.order_id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_minmax(0,1fr)]">
                    <span className="min-w-0 truncate tabular-nums" title={p.order_id}>{p.order_id}</span>
                    <span className="text-right tabular-nums sm:text-left">{money(p.amount_minor, p.currency)}</span>
                    <span className="justify-self-start"><StatusBadge status={p.status} /></span>
                    <span className="text-right text-muted-foreground sm:text-left">{fmtDate(p.created_at)}</span>
                  </li>
                ))}
              </ul>
              {data.payments.length === 0 && <p className="py-8 text-center text-muted-foreground">No payments yet.</p>}
            </div>
          </Section>
        </>
      );
      case "pricing": return (
        <>
          <Section title="Publication fee" meta="Change what authors pay"><div className="min-w-0 px-4 py-5 sm:px-5"><Quiet><FeeAdmin /></Quiet></div></Section>
          <Section title="Promo codes"><div className="min-w-0 px-4 py-5 sm:px-5"><Quiet><PromoAdmin /></Quiet></div></Section>
        </>
      );
      case "waivers": return <div className="min-w-0"><FeeWaivers /></div>;
      case "banners": return <Section title="Banners and offers" meta="Announcements, promo banners, copy-code button"><div className="min-w-0 px-4 py-5 sm:px-5"><BannerAdmin /></div></Section>;
      case "users": return <Quiet><RoleManager /></Quiet>;
      case "email": return <Quiet><AdminEmail /></Quiet>;
      case "activity": return <Section title="Activity log" meta="Who did what, newest first"><div className="min-w-0 px-4 py-5 sm:px-5"><AuditPanel /></div></Section>;
      case "settings": return <Quiet><PublicationSettings /></Quiet>;
      case "identity": return (
        <>
          <Section title="Journal identity"><div className="min-w-0 px-4 py-5 sm:px-5"><Quiet><IdentityPanel /></Quiet></div></Section>
          <Section title="Editorial board"><div className="min-w-0 px-4 py-5 sm:px-5"><Quiet><BoardPanel /></Quiet></div></Section>
        </>
      );
      case "doi": return <Section title="DOI registration (Zenodo)" meta="Editors approve; administrators retry and configure"><div className="min-w-0 px-4 py-5 sm:px-5"><ZenodoAdmin /></div></Section>;
      case "tools": return <Section title="Test tools" meta="Admin only"><div className="min-w-0 px-4 py-5 sm:px-5"><Quiet><TestMode /></Quiet></div></Section>;
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-20 pt-8 sm:px-5 sm:pt-10">
      <header className="mb-6 sm:mb-8">
        <h1 className="text-[clamp(1.6rem,1.3rem+1.2vw,2.1rem)] text-foreground">Admin</h1>
        {perms.has("EDITORIAL_REVIEW") && <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border bg-background px-5 py-4 sm:grid-cols-4 lg:grid-cols-6" aria-label="Papers by status">
          {Object.entries(data.byStatus).map(([st, n]) => (
            <div key={st} className="min-w-0">
              <dd className="text-[1.5rem] font-semibold leading-none tabular-nums">{String(n)}</dd>
              <dt className="mt-1.5 text-[13px] leading-snug text-muted-foreground [overflow-wrap:break-word]">{STATUS_LABEL[st] ?? st}</dt>
            </div>
          ))}
        </dl>}
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        {/* Areas: a 2 or 4 column grid on small screens, a sticky list on large ones. Labels never wrap letter by letter. */}
        <nav aria-label="Admin areas" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:sticky lg:top-24 lg:block lg:space-y-1 lg:self-start">
          {groups.map((g) => {
            const active = activeGroup?.id === g.id;
            const target = active ? shown! : g.items[0]!.id;
            return (
              <button
                key={g.id} type="button" onClick={() => { if (!active) go(target); }} aria-current={active ? "page" : undefined}
                className={`nav-item flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-[15px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 ${active ? "bg-primary/10 font-semibold text-primary" : "text-foreground/80 hover:bg-wash hover:text-foreground"}`}
              >
                <span className="whitespace-nowrap">{g.label}</span>
                {g.id === "editorial" && data.queue.length > 0 && <span className="rounded-full bg-primary px-2 text-[12px] font-medium tabular-nums text-primary-foreground">{data.queue.length}</span>}
              </button>
            );
          })}
        </nav>

        <main className="min-w-0 space-y-6" aria-labelledby="admin-page-h">
          {activeGroup && (
            <div ref={body} className="scroll-mt-24">
              <p className="m-0 text-sm text-muted-foreground">{activeGroup.blurb}</p>
              {activeGroup.items.length > 1 && (
                <div role="group" aria-label={`${activeGroup.label} sections`} className="mt-3 flex flex-wrap gap-1.5 border-b border-border pb-3">
                  {activeGroup.items.map((it) => {
                    const active = shown === it.id;
                    return (
                      <button key={it.id} type="button" onClick={() => go(it.id)} aria-current={active ? "page" : undefined}
                        className={`nav-item inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-4 text-[15px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 ${active ? "border-primary bg-primary text-primary-foreground font-semibold" : "border-border bg-background text-foreground/80 hover:border-primary/40 hover:bg-wash hover:text-foreground"}`}>
                        {it.label}
                        {it.id === "review" && data.queue.length > 0 && <span className={`ml-2 rounded-full px-1.5 text-[12px] font-medium tabular-nums ${active ? "bg-primary-foreground/20" : "bg-primary text-primary-foreground"}`}>{data.queue.length}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {shown ? <PageHead id="admin-page-h" title={LABEL[shown]!} /> : null}
          {visited.filter((id) => allowedIds.includes(id)).map((id) => (
            <div key={id} hidden={id !== shown} className="min-w-0 space-y-8 [&_h2]:text-foreground">{panel(id)}</div>
          ))}
        </main>
      </div>
    </div>
  );
}

/** The page title. Components that carry their own heading are wrapped in <Quiet>, which hides that duplicate visually and keeps it for screen readers. */
function PageHead({ id, title }: { id: string; title: string }) {
  return <h2 id={id} className="m-0 text-[1.5rem] font-semibold leading-tight tracking-tight">{title}</h2>;
}
function Quiet({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 [&_h2]:sr-only [&_h2+p]:mt-0 [&_section>h2]:sr-only">{children}</div>;
}

/** A quiet surface for one block of content. Content never widens the page: min-w-0 and an overflow guard. */
function Section({ title, meta, children }: { title: string; meta?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="surface min-w-0 max-w-full overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border px-4 py-3.5 sm:px-5">
        <h3 id={id} className="m-0 text-[1.0625rem] font-semibold leading-snug">{title}</h3>
        {meta && <p className="m-0 text-sm text-muted-foreground">{meta}</p>}
      </div>
      <div className="min-w-0 max-w-full">{children}</div>
    </section>
  );
}

const QUICK_REASONS: Record<"ACCEPT" | "REJECT" | "MINOR_REVISION" | "MAJOR_REVISION", string[]> = {
  ACCEPT: ["Meets scope and quality standards.", "Sound methodology, clear contribution, ready as submitted."],
  MINOR_REVISION: ["Promising, but needs small clarifications before acceptance.", "Address reviewer comments on wording and formatting."],
  MAJOR_REVISION: ["Substantial gaps in methodology need to be addressed.", "Core argument needs stronger evidence before reconsideration."],
  REJECT: ["Outside the scope of this publication.", "Does not meet the required methodological standard."],
};

const field = "flex h-11 w-full rounded-lg border border-input bg-background px-3 text-base";

/** Approved papers that are paid but not yet published. One click runs the same job as the daily sweep and reports what happened per paper. */
function PublishWaitingBanner({ count, onDone }: { count: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  async function run() {
    setBusy(true);
    try {
      const r = await adminPublishWaiting();
      if (r.published === r.waiting) toast.success(`Published ${r.published} paper${r.published === 1 ? "" : "s"}`);
      else toast.error(`Published ${r.published} of ${r.waiting}. ${r.results.filter((x) => !x.published).map((x) => `${x.public_id}: ${x.error}`).join("; ")}`);
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not publish"); } finally { setBusy(false); }
  }
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 border border-border bg-wash px-4 py-3 sm:px-5">
      <p className="text-sm">{count} approved paper{count === 1 ? " is" : "s are"} waiting to be published.</p>
      <Button type="button" onClick={run} disabled={busy}>{busy ? "Publishing…" : "Publish waiting papers now"}</Button>
    </div>
  );
}

function Review({ id, status, canDecide, canPublish, onDone, onClose }: { id: string; status: string; canDecide: boolean; canPublish: boolean; onDone: () => void; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["admin-paper", id], queryFn: () => adminPaperReport({ data: { id } }) });
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<"ACCEPT" | "REJECT" | "MINOR_REVISION" | "MAJOR_REVISION" | null>(null);
  async function decide(outcome: "ACCEPT" | "REJECT" | "MINOR_REVISION" | "MAJOR_REVISION") {
    setBusy(true); setPending(outcome);
    try { const r = await editorDecide({ data: { paperId: id, outcome, ...(reason.trim() ? { reason } : {}) } }); toast.success(r.startedPeerReview ? "Approved for peer review. Now assign reviewers." : "Decision recorded"); onDone(); if (!r.startedPeerReview) onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not record decision"); } finally { setBusy(false); setPending(null); }
  }
  async function publish() {
    setBusy(true);
    try { await adminPublish({ data: { paperId: id } }); toast.success("Published"); onDone(); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not publish"); } finally { setBusy(false); }
  }
  if (isLoading || !data) return <div className="px-5 pb-5 text-sm text-muted-foreground">Loading report…</div>;
  const meter = data.aiMeter as AiMeterData | null;
  return (
    <div className="space-y-6 border-t border-border bg-wash px-5 py-6">
      <p className="text-sm leading-relaxed">{data.paper.abstract}</p>
      <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Automated screening is information to help the editor. It is not peer review and not an editorial decision. It is a prompt for human review.</p>
      {data.run && <p className="text-xs text-muted-foreground">Screened by {data.run.model} under {data.run.policy}.</p>}
      {data.verification && (data.verification.coverage || data.verification.evidence || data.verification.unconfirmed || data.verification.adjusted) && (
        <div className="space-y-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground" role="note" aria-label="How far to trust this screening">
          {data.verification.coverage && <p><span className="font-medium text-foreground">Manuscript read:</span> {data.verification.coverage}</p>}
          {data.verification.evidence && <p><span className="font-medium text-foreground">Quotations checked:</span> {data.verification.evidence}</p>}
          {data.verification.unconfirmed && <p><span className="font-medium text-foreground">Unconfirmed (treated as questions, not findings):</span> {data.verification.unconfirmed.replace(/_/g, " ")}</p>}
          {data.verification.adjusted && <p><span className="font-medium text-foreground">Adjusted to match hard facts:</span> {data.verification.adjusted}</p>}
        </div>
      )}
      <ul className="divide-y divide-border border-y border-border bg-background">
        {data.findings.map((f) => (
          <li key={f.check_key} className="px-4 py-3 text-[15px]"><div className="flex justify-between gap-3"><span className="font-semibold">{f.check_key.replace("_", " ")}</span><span className="text-xs uppercase tracking-wide text-muted-foreground">{f.status}</span></div>{f.message && <p className="mt-1 text-sm text-muted-foreground">{f.message}</p>}{f.evidence.filter((e) => e.quote).slice(0, 2).map((e, i) => <blockquote key={i} className="mt-2 border-l-2 border-border pl-3 text-xs italic text-muted-foreground">“{e.quote}”{e.verified === true ? <span className="ml-2 not-italic text-foreground">· found in manuscript</span> : e.verified === false ? <span className="ml-2 not-italic font-medium text-foreground">· not found in manuscript</span> : null}</blockquote>)}</li>
        ))}
      </ul>
      {meter && <AiMeter meter={meter} />}
      <PeerReviewPanel paperId={id} status={status} onChanged={onDone} />
      {["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"].includes(status) && !data.paper.review_waived && <AdminSkipReview paperId={id} onDone={() => { onDone(); onClose(); }} />}
      <div className="flex flex-wrap"><DeleteResearchButton paper={{ id, public_id: data.paper.public_id, paperly_id: data.paper.paperly_id ?? null, title: data.paper.title, status }} onDone={() => { onDone(); onClose(); }} /></div>
      <RefsPanel paperId={id} />
      {canPublish && (
        <div className="space-y-2"><p className="text-sm">Accepted and paid. Publishing registers a DOI only if a DOI provider is configured; otherwise the record is published without DOI.</p><Button onClick={publish} className="rounded-full">Publish paper</Button></div>
      )}
      {canDecide && (
        <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
          <p className="text-sm font-medium text-muted-foreground">Decision — tap a reason, then a verdict</p>
          <div className="flex flex-wrap gap-1.5">{QUICK_REASONS.ACCEPT.concat(QUICK_REASONS.MINOR_REVISION, QUICK_REASONS.MAJOR_REVISION, QUICK_REASONS.REJECT).map((r) => <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-border bg-wash px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">{r}</button>)}</div>
          <Textarea rows={2} placeholder="What changes are needed, or the reason (optional — the author will see it)" value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-2xl" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Button size="lg" disabled={busy} onClick={() => decide("ACCEPT")} variant="positive" className="rounded-full">{pending === "ACCEPT" ? "Approving…" : status === "REVIEW_REQUIRED" ? "✓ Approve for peer review" : "✓ Approve"}</Button>
            <Button size="lg" disabled={busy || status === "REVIEW_REQUIRED"} variant="outline" onClick={() => decide("MINOR_REVISION")} className="rounded-full">{pending === "MINOR_REVISION" ? "Sending…" : "Minor revision"}</Button>
            <Button size="lg" disabled={busy || status === "REVIEW_REQUIRED"} variant="outline" onClick={() => decide("MAJOR_REVISION")} className="rounded-full">{pending === "MAJOR_REVISION" ? "Sending…" : "Major revision"}</Button>
            <Button size="lg" disabled={busy} variant="destructive" onClick={() => decide("REJECT")} className="rounded-full">{pending === "REJECT" ? "Rejecting…" : "✕ Disapprove"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">One tap on a reason chip fills the box — review it, then hit the verdict button. The author sees this text.</p>
        </div>
      )}
    </div>
  );
}

/** Administrator-only: approve a paper without peer review. Recorded with a reason; the paper is never marked peer reviewed. */
function AdminSkipReview({ paperId, onDone }: { paperId: string; onDone: () => void }) {
  const [why, setWhy] = useState(""); const [busy, setBusy] = useState(false);
  async function go() {
    if (!window.confirm("Approve this paper as an administrator? It will be marked peer reviewed. Any open reviewer invitations will be cancelled.")) return;
    setBusy(true);
    try { await adminApproveWithoutReview({ data: { paperId, ...(why.trim() ? { reason: why.trim() } : {}) } }); toast.success("Approved and marked peer reviewed"); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not approve"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-background p-4">
      <p className="text-sm font-medium">Administrator: approve and mark peer reviewed</p>
      <p className="text-xs text-muted-foreground">Skips reviewer assignment. Administrator accounts belong to professors and teachers, so an administrator approval marks the paper peer reviewed. A note is optional and is saved in the audit log. Administrators only.</p>
      <Textarea rows={2} placeholder="Note (optional)" value={why} onChange={(e) => setWhy(e.target.value)} className="rounded-2xl" />
      <Button variant="outline" disabled={busy} onClick={go} className="rounded-full">{busy ? "Approving…" : "Approve (peer reviewed)"}</Button>
    </div>
  );
}

function PeerReviewPanel({ paperId, status, onChanged }: { paperId: string; status: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["editor-reviews", paperId, status], queryFn: () => editorReviews({ data: { paperId } }), retry: false });
  const reviewers = useQuery({ queryKey: ["reviewer-list"], queryFn: () => editorListReviewers(), retry: false, enabled: ["REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"].includes(status) });
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [why, setWhy] = useState("");
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); await qc.invalidateQueries({ queryKey: ["editor-reviews", paperId] }); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Action failed"); } finally { setBusy(false); }
  }
  if (!q.data) return q.error ? <p className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Could not load review information"}</p> : null;
  const d = q.data;
  if (d.paper.review_waived) return <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">Approved by an administrator and marked peer reviewed. No editor or reviewers are needed for this paper.</p>;
  const inReview = ["REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"].includes(status);
  const done = d.reviews.filter((r) => r.status === "COMPLETED").length;
  return (
    <section className="space-y-4 rounded-lg border border-border bg-background p-4" aria-label="Peer review">
      <h3 className="text-[1.0625rem]">Editorial handling</h3>
      <p><Link to="/manuscript/$paperId" params={{ paperId }} className="link text-sm font-medium">Open the manuscript in the browser with tracked changes</Link></p>
      <p className="text-sm text-muted-foreground">Record type: <span className="font-medium text-foreground">{d.paper.publication_type.replace(/_/g, " ").toLowerCase()}</span>. Peer review model: <span className="font-medium text-foreground">{(d.paper.review_model ? REVIEW_MODEL_LABEL[d.paper.review_model as keyof typeof REVIEW_MODEL_LABEL] : undefined) ?? d.paper.review_model}</span>.</p>
      {status === "REVIEW_REQUIRED" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">Record type<select className={field} value={d.paper.publication_type} disabled={busy} onChange={(e) => run(() => editorSetPublicationType({ data: { paperId, type: e.target.value as "REPOSITORY_RECORD" | "PREPRINT" | "JOURNAL_ARTICLE" } }), "Record type updated")}><option value="REPOSITORY_RECORD">Repository record</option><option value="PREPRINT">Preprint</option><option value="JOURNAL_ARTICLE" disabled={!d.journalMode}>Journal article{d.journalMode ? "" : " (journal mode is off)"}</option></select></label>
          <Button variant="outline" disabled={busy} onClick={() => run(() => editorStartPeerReview({ data: { paperId } }), "Peer review started")}>Start peer review</Button>
        </div>
      )}
      {d.reviews.length > 0 && (
        <ul className="divide-y divide-border border-y border-border text-[15px]">
          {d.reviews.map((r) => (
            <li key={r.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.reviewer_name}{r.reviewer_institution ? `, ${r.reviewer_institution}` : ""}</span><span className="text-xs text-muted-foreground uppercase tracking-wide">{r.status}</span></div>
              {r.coi_status && r.coi_status !== "NONE" && <p className="text-sm text-caution">Conflict of interest: {r.coi_status.toLowerCase()}{r.coi_statement ? `, ${r.coi_statement}` : ""}</p>}
              {r.status === "COMPLETED" && <><p className="text-sm">Recommendation: <span className="font-semibold">{String(r.recommendation).replace(/_/g, " ").toLowerCase()}</span></p><p className="text-xs text-muted-foreground">{r.comments}</p></>}
              {r.status === "REQUESTED" && (
                <div className="flex flex-wrap items-center gap-2 pt-1"><span className="text-sm text-muted-foreground">Asked to review from the open list.</span><Button size="sm" disabled={busy} onClick={() => run(() => editorApproveRequest({ data: { assignmentId: r.id } }), "Request approved")}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => editorDeclineRequest({ data: { assignmentId: r.id } }), "Request declined")}>Decline</Button></div>
              )}
              {["INVITED", "ACCEPTED"].includes(r.status) && (
                <div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => editorExtendDeadline({ data: { assignmentId: r.id, days: 7 } }), "Deadline extended by 7 days")}>Extend</Button>{pick && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => editorReplaceReviewer({ data: { assignmentId: r.id, newReviewerId: pick } }), "Reviewer replaced")}>Replace</Button>}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW"].includes(status) && (
        <div className="space-y-1">
          <label className="block text-sm font-medium">Open reviewer list<select className={field + " max-w-sm"} value={d.paper.open_claims} disabled={busy} onChange={(e) => run(() => editorSetOpenClaims({ data: { paperId, mode: e.target.value as "OPEN" | "APPROVAL" | "OFF" } }), "Open list updated")}><option value="OPEN">Open: any reviewer can take it</option><option value="APPROVAL">Reviewers ask, I approve each one</option><option value="OFF">Off: invited reviewers only</option></select></label>
          <p className="text-xs text-muted-foreground">Controls whether this paper appears under “Waiting for reviewers”. Reviewers you invite are not affected.</p>
        </div>
      )}
      {inReview && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Invite or choose a reviewer<select className={field} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Select…</option>{(reviewers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.display_name}{r.institution ? `, ${r.institution}` : ""}</option>)}</select></label>
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !pick} onClick={() => run(() => editorInviteReviewer({ data: { paperId, reviewerId: pick } }), "Reviewer invited")}>Invite reviewer</Button>{status === "PEER_REVIEW" && done > 0 && <><input className={field + " max-w-xs"} placeholder="Reason for closing reviews" value={why} onChange={(e) => setWhy(e.target.value)} /><Button size="sm" variant="outline" disabled={busy || why.trim().length < 10} onClick={() => run(() => editorCloseReviews({ data: { paperId, reason: why } }), "Moved to editorial decision")}>Close reviews</Button></>}</div>
          {(reviewers.data ?? []).length === 0 && reviewers.isSuccess && <p className="text-sm text-muted-foreground">No users have the reviewer role yet. An administrator can grant it below.</p>}
        </div>
      )}
    </section>
  );
}

function RefsPanel({ paperId }: { paperId: string }) {
  const qc = useQueryClient();
  const refs = useQuery({ queryKey: ["refs", paperId], queryFn: () => myPaperReferences({ data: { paperId } }) });
  const [busy, setBusy] = useState(false);
  if (!refs.data || refs.data.length === 0) return <p className="text-sm text-muted-foreground">No reference list was submitted.</p>;
  async function run() {
    setBusy(true);
    try { const r = await validatePaperReferences({ data: { paperId } }); toast.success(`Checked ${r.total} references`); await qc.invalidateQueries({ queryKey: ["refs", paperId] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not check the references"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-semibold">References ({refs.data.length})</h3><Button variant="outline" disabled={busy} onClick={run}>{busy ? "Checking…" : "Validate refs"}</Button></div><p className="text-xs text-muted-foreground">The check looks up each DOI at Crossref. It is a prompt for a human to look, not a verdict on any reference.</p><ol className="divide-y divide-border border-y border-border text-sm">{refs.data.map((r) => <li key={r.position} className="py-2"><span className="mr-2 tabular-nums text-muted-foreground">{r.position}.</span>{r.raw_text}<div className="mt-1 text-xs text-muted-foreground">{REFERENCE_STATUS_LABEL[r.validation_status as ReferenceStatus]}{r.validation_note ? `: ${r.validation_note}` : ""}</div></li>)}</ol></div>
  );
}

function NoticePanel() {
  const [f, setF] = useState({ paperlyId: "", kind: "ERRATUM", notice: "", reason: "", newTitle: "", newAbstract: "" });
  const [busy, setBusy] = useState(false);
  const [fixed, setFixed] = useState<File | null>(null);
  const heavy = f.kind === "RETRACTION" || f.kind === "WITHDRAWAL";
  async function send() {
    if (heavy && !window.confirm(`This marks ${f.paperlyId} as retracted. The record stays public with a visible notice and its certificates are marked. Continue?`)) return;
    setBusy(true);
    try {
      if (f.kind === "CORRECTION" && fixed) {
        const fd = new FormData();
        fd.append("paperlyId", f.paperlyId.trim()); await appendFile(fd, "file", fixed); fd.append("notice", f.notice); fd.append("reason", f.reason);
        if (f.newTitle.trim()) fd.append("newTitle", f.newTitle.trim()); if (f.newAbstract.trim()) fd.append("newAbstract", f.newAbstract.trim());
        const r = await adminIssueCorrectedVersion({ data: fd });
        toast.success(`Corrected version ${r.version} published`);
      } else {
        await adminIssueNotice({ data: { paperlyId: f.paperlyId.trim(), kind: f.kind as "ERRATUM", notice: f.notice, reason: f.reason, newTitle: f.newTitle.trim() || undefined, newAbstract: f.newAbstract.trim() || undefined } });
        toast.success("Notice issued");
      }
      setFixed(null); setF({ ...f, notice: "", reason: "", newTitle: "", newAbstract: "" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not issue the notice"); } finally { setBusy(false); }
  }
  return (<div><h2 className="border-b border-border pb-2 text-[1.5rem]">Corrections and retractions</h2><p className="mt-3 max-w-[70ch] text-[15px]">Notices are permanent and public. A published record is never edited silently: a correction, erratum, expression of concern, withdrawal or retraction stays visible in the record.</p><div className="mt-4 grid max-w-2xl gap-4"><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Paperly ID<input className={field} placeholder="PLY-2026-000001" value={f.paperlyId} onChange={(e) => setF({ ...f, paperlyId: e.target.value })} /></label><label className="block text-sm font-medium">Notice type<select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="ERRATUM">Erratum (publisher error)</option><option value="CORRECTION">Correction (changes the record)</option><option value="ADDENDUM">Addendum</option><option value="EXPRESSION_OF_CONCERN">Expression of concern</option><option value="WITHDRAWAL">Withdrawal</option><option value="RETRACTION">Retraction</option></select></label></div><label className="block text-sm font-medium">Public notice text (at least 20 characters)<Textarea rows={4} value={f.notice} onChange={(e) => setF({ ...f, notice: e.target.value })} /></label><label className="block text-sm font-medium">Internal reason (at least 10 characters, kept in the audit log)<Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>{f.kind === "CORRECTION" && (<><label className="block text-sm font-medium">Corrected title (optional)<input className={field} value={f.newTitle} onChange={(e) => setF({ ...f, newTitle: e.target.value })} /></label><label className="block text-sm font-medium">Corrected abstract (optional)<Textarea rows={5} value={f.newAbstract} onChange={(e) => setF({ ...f, newAbstract: e.target.value })} /></label><label className="block text-sm font-medium">Corrected manuscript (PDF or .docx, optional)<input type="file" accept={MANUSCRIPT_ACCEPT} className="mt-1 block w-full" onChange={(e) => setFixed(e.target.files?.[0] ?? null)} /><span className="mt-1 block text-sm font-normal text-muted-foreground">With a file, the correction is published as a new version. The earlier version and its hash stay on the record.</span></label></>)}<div><Button variant={heavy ? "destructive" : "default"} disabled={busy || !f.paperlyId || f.notice.trim().length < 20 || f.reason.trim().length < 10} onClick={send}>{f.kind === "CORRECTION" ? (busy ? "Uploading…" : "Publish correction") : (busy ? "Saving…" : "Issue notice")}</Button></div></div></div>);
}

function IdentityPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-identity"], queryFn: () => adminGetIdentity() });
  const [f, setF] = useState<null | Record<string, string>>(null);
  const [assigned, setAssigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (!d) return null;
  const v = f ?? { journal_title: d.journal_title, publisher_name: d.publisher_name ?? "", aims_scope: d.aims_scope ?? "", publication_frequency: d.publication_frequency, editorial_office_email: d.editorial_office_email ?? "", editorial_office_address: d.editorial_office_address ?? "", issn: d.issn ?? "", eissn: d.eissn ?? "" };
  const set = (k: string, val: string) => setF({ ...v, [k]: val });
  async function save() {
    setBusy(true);
    try { await adminSaveIdentity({ data: { ...v, issn_officially_assigned: assigned } as never }); toast.success("Saved"); setF(null); await qc.invalidateQueries({ queryKey: ["admin-identity"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  return (<div><h2 className="border-b border-border pb-2 text-[1.5rem]">Journal identity</h2><p className="mt-3 max-w-[70ch] text-[15px]">Leave the ISSN fields empty until an official ISSN has been assigned to this publication. An ISSN is shown publicly only after you confirm it was officially assigned.</p><div className="mt-4 grid max-w-2xl gap-4"><label className="block text-sm font-medium">Title<input className={field} value={v["journal_title"]} onChange={(e) => set("journal_title", e.target.value)} /></label><label className="block text-sm font-medium">Publisher<input className={field} value={v["publisher_name"]} onChange={(e) => set("publisher_name", e.target.value)} /></label><label className="block text-sm font-medium">Aims and scope (replaces the default text on the About page)<Textarea rows={5} value={v["aims_scope"]} onChange={(e) => set("aims_scope", e.target.value)} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block font-medium">Publication frequency<input className={field} value={v["publication_frequency"]} onChange={(e) => set("publication_frequency", e.target.value)} /></label><label className="block font-medium">Editorial office email<input className={field} type="email" value={v["editorial_office_email"]} onChange={(e) => set("editorial_office_email", e.target.value)} /></label></div><label className="block text-sm font-medium">Editorial office address<Textarea rows={2} value={v["editorial_office_address"]} onChange={(e) => set("editorial_office_address", e.target.value)} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">ISSN (print)<input className={field} placeholder="NNNN-NNNN" value={v["issn"]} onChange={(e) => set("issn", e.target.value)} /></label><label className="block text-sm font-medium">ISSN (online)<input className={field} placeholder="NNNN-NNNN" value={v["eissn"]} onChange={(e) => set("eissn", e.target.value)} /></label></div>{(v["issn"] || v["eissn"]) && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={assigned} onChange={(e) => setAssigned(e.target.checked)} /><span>Officially assigned</span></label>}<div><Button disabled={busy} onClick={save}>Save identity</Button></div></div></div>);
}

function BoardPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-board"], queryFn: () => adminListBoard() });
  const blank = { full_name: "", affiliation: "", country: "", credentials: "", orcid: "", role: "EDITORIAL_BOARD_MEMBER", biography: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-board"] }).then(() => qc.invalidateQueries({ queryKey: ["editorial-board"] }));
  async function run(fn: () => Promise<unknown>, ok: string) { setBusy(true); try { await fn(); toast.success(ok); await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } }
  return (<div><h2 className="border-b border-border pb-2 text-[1.5rem]">Editorial board</h2><p className="mt-3 max-w-[70ch] text-[15px]">Add only real people who have agreed to serve. A new entry is hidden. It appears on the public board only after you press Confirm, which records the action in the audit trail.</p><ul className="mt-4 divide-y divide-border border-y border-border text-sm">{(q.data ?? []).map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span><span className="font-semibold">{m.full_name}</span>, {m.affiliation} <span className="text-muted-foreground">({m.role.replace(/_/g, " ").toLowerCase()})</span> {m.confirmed ? <span className="ml-1 text-positive">• confirmed</span> : <span className="ml-1 text-muted-foreground">• pending</span>}</span><span className="flex gap-2"><Button size="sm" variant={m.confirmed ? "outline" : "default"} disabled={busy} onClick={() => run(() => adminConfirmBoardMember({ data: { id: m.id, confirmed: !m.confirmed } }), m.confirmed ? "Board member unconfirmed" : "Board member confirmed")}>{m.confirmed ? "Unconfirm" : "Confirm"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Remove ${m.full_name}?`)) void run(() => adminDeleteBoardMember({ data: { id: m.id } }), "Board member removed"); }}>Remove</Button></span></li>)}</ul><div className="mt-4 grid max-w-2xl gap-4"><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Full name<input className={field} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label><label className="block text-sm font-medium">Role<select className={field} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="EDITOR_IN_CHIEF">Editor-in-chief</option><option value="ASSOCIATE_EDITOR">Associate editor</option><option value="EDITORIAL_BOARD_MEMBER">Editorial board member</option></select></label><label className="block text-sm font-medium">Affiliation<input className={field} value={f.affiliation} onChange={(e) => setF({ ...f, affiliation: e.target.value })} /></label><label className="block text-sm font-medium">Country<input className={field} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></label><label className="block text-sm font-medium">Credentials (optional)<input className={field} value={f.credentials} onChange={(e) => setF({ ...f, credentials: e.target.value })} /></label><label className="block text-sm font-medium">ORCID iD (optional)<input className={field} placeholder="0000-0000-0000-0000" value={f.orcid} onChange={(e) => setF({ ...f, orcid: e.target.value })} /></label></div><label className="block text-sm font-medium">Biography (optional)<Textarea rows={3} value={f.biography} onChange={(e) => setF({ ...f, biography: e.target.value })} /></label><div><Button disabled={busy || f.full_name.trim().length < 2 || f.affiliation.trim().length < 2} onClick={() => run(async () => { await adminSaveBoardMember({ data: { ...f, role: f.role as any } as never }); setF(blank); }, "Board member added")}>Add board member</Button></div></div></div>);
}

function AuditPanel() {
  const [filters, setFilters] = useState({ action: "", resource: "" });
  const [applied, setApplied] = useState({ action: "", resource: "" });
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["audit", applied, page], queryFn: () => adminAuditLog({ data: { action: applied.action || undefined, resource: applied.resource || undefined, page } }) });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (<div><form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(filters); setPage(1); }}><label className="text-sm font-medium">Action contains<input className={field} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} placeholder="decision, payment…" /></label><label className="text-sm font-medium">Resource<input className={field} value={filters.resource} onChange={(e) => setFilters({ ...filters, resource: e.target.value })} placeholder="paper id or resource" /></label><Button type="submit" variant="outline">Filter</Button></form><div className="mt-4 max-w-full"><table className="rtable w-full text-left text-xs"><thead><tr className="border-b border-border"><th className="py-2 pr-3">Time</th><th className="pr-3">Action</th><th className="pr-3">Resource</th><th>Change</th></tr></thead><tbody>{(q.data?.rows ?? []).map((r) => <tr key={r.id} className="border-b border-border align-top"><td data-label="Time" className="py-2 pr-3 sm:whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td><td data-label="Action" className="pr-3">{r.action}</td><td data-label="Resource" className="pr-3 break-words">{r.resource_type} {r.resource_id?.slice(0, 13)}</td><td data-label="Change" className="break-words text-muted-foreground sm:text-left">{r.old_value ? JSON.stringify(r.old_value) : ""}{r.old_value || r.new_value ? " → " : ""}{r.new_value ? JSON.stringify(r.new_value) : ""}</td></tr>)}</tbody></table></div><div className="mt-3 flex items-center justify-between text-sm"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>);
}

function PublicationSettings() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["editorial-settings"], queryFn: () => adminGetSettings(), retry: false });
  const [busy, setBusy] = useState(false);
  if (!s.data) return null;
  async function save(patch: { journal_mode_enabled?: boolean; default_review_model?: "SINGLE_ANONYMOUS" | "DOUBLE_ANONYMOUS" | "OPEN"; reviews_required?: number; review_days?: number }) {
    setBusy(true);
    try { await adminUpdateSettings({ data: patch }); toast.success("Saved"); await qc.invalidateQueries({ queryKey: ["editorial-settings"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  const d = s.data;
  return (
    <div className="space-y-8">
      <div><h2 className="border-b border-border pb-2 text-[1.5rem]">Publication settings</h2><div className="mt-4 space-y-4 text-[15px]"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={d.journal_mode_enabled} disabled={busy} onChange={(e) => save({ journal_mode_enabled: e.target.checked })} /><span>Journal mode enabled</span></label><label className="block max-w-md font-medium">Default review model<select className={field} value={d.default_review_model} disabled={busy} onChange={(e) => save({ default_review_model: e.target.value as "DOUBLE_ANONYMOUS" })}>{Object.entries(REVIEW_MODEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><div className="grid max-w-md gap-4 sm:grid-cols-2"><label className="block font-medium">Reviews required<input type="number" min={1} max={5} className={field} defaultValue={d.reviews_required} disabled={busy} onBlur={(e) => save({ reviews_required: Number(e.target.value) })} /></label><label className="block font-medium">Review days<input type="number" min={3} max={90} className={field} defaultValue={d.review_days} disabled={busy} onBlur={(e) => save({ review_days: Number(e.target.value) })} /></label></div></div></div>
    </div>
  );
}

function FeeAdmin() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["admin-fees"], queryFn: () => adminGetPublicationFees(), retry: false });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return null;
  async function save(currency: string, current: number) {
    const raw = draft[currency];
    const minor = Math.round(parseFloat(raw ?? "") * 100);
    if (!Number.isFinite(minor) || minor < 100) { toast.error("Enter the fee as an amount of at least 1.00"); return; }
    if (minor === current) { toast.message("That is already the fee"); return; }
    if (!window.confirm(`Change the ${currency} publication fee from ${money(current, currency)} to ${money(minor, currency)}? It applies to payments started from now on.`)) return;
    setBusy(currency);
    try {
      const r = await adminSetPublicationFee({ data: { currency, amountMinor: minor } });
      toast.success(`${currency} fee is now ${money(minor, currency)}${r.blockedPromos ? `. ${r.blockedPromos} active promo code${r.blockedPromos === 1 ? "" : "s"} take${r.blockedPromos === 1 ? "s" : ""} off too much for this fee and will be refused at checkout` : ""}`);
      setDraft((d) => { const { [currency]: _gone, ...rest } = d; void _gone; return rest; });
      qc.invalidateQueries({ queryKey: ["admin-fees"] }); qc.invalidateQueries({ queryKey: ["public-fees"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not change the fee"); }
    finally { setBusy(null); }
  }
  return (<section aria-labelledby="fee-admin-h"><h2 id="fee-admin-h" className="border-b border-border pb-2 text-[1.5rem]">Publication fee</h2>
    <p className="mt-3 max-w-[70ch] text-[15px] text-muted-foreground">The amount an author pays after uploading a manuscript. A new amount applies to payments started from now on; a payment already in progress keeps the amount it began with. The public Fees page shows the new amount straight away. If a paper is rejected, {money(data?.retainedMinor ?? 0, "INR")} is kept (or the whole payment, if it is less) and the rest is refunded. That kept amount is fixed and is not changed here.</p>
    <table className="rtable mt-4 w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2 font-medium">Currency</th><th className="font-medium">Current fee</th><th className="font-medium">New fee</th><th className="font-medium">Status</th><th /></tr></thead>
      <tbody>{(data?.prices ?? []).filter((p) => p.active).map((p) => <tr key={p.currency} className="border-b border-border">
        <td data-label="Currency" className="py-2.5 font-mono">{p.currency}</td><td data-label="Current fee" className="tabular-nums">{money(p.amountMinor, p.currency)}</td>
        <td data-label="New fee"><Input aria-label={`New ${p.currency} fee`} className="h-9 w-32" inputMode="decimal" placeholder={(p.amountMinor / 100).toString()} value={draft[p.currency] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p.currency]: e.target.value }))} /></td>
        <td data-label="Status" className="text-muted-foreground">{p.payable ? "Charged at checkout" : "Not charged at the moment"}</td>
        <td data-label="" className="text-right"><Button size="sm" onClick={() => save(p.currency, p.amountMinor)} disabled={busy !== null || !(draft[p.currency] ?? "").trim()}>{busy === p.currency ? "Saving…" : "Save fee"}</Button></td></tr>)}</tbody></table>
    {data && data.prices.filter((p) => p.active).length === 0 && <p className="py-4 text-muted-foreground">No active price is configured.</p>}
  </section>);
}

function PromoAdmin() {
  const qc = useQueryClient();
  const { data: promos, error } = useQuery({ queryKey: ["admin-promos"], queryFn: () => adminListPromoCodes(), retry: false });
  const [code, setCode] = useState("");
  const [rupees, setRupees] = useState("");
  const [max, setMax] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  if (error) return null;
  async function create() {
    const off = Math.round(parseFloat(rupees) * 100);
    if (!Number.isFinite(off) || off <= 0) { toast.error("Enter the amount off in rupees"); return; }
    setBusy(true);
    try { await adminCreatePromoCode({ data: { code, amountOffMinor: off, maxRedemptions: max ? parseInt(max, 10) : null, expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null } }); toast.success("Promo code created"); setCode(""); setRupees(""); setMax(""); setExpires(""); qc.invalidateQueries({ queryKey: ["admin-promos"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the code"); }
    finally { setBusy(false); }
  }
  async function toggle(id: string, active: boolean) {
    try { await adminSetPromoCodeActive({ data: { id, active } }); qc.invalidateQueries({ queryKey: ["admin-promos"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the code"); }
  }
  return (<section aria-labelledby="promo-h"><h2 id="promo-h" className="mt-12 border-b border-border pb-2 text-[1.5rem]">Promo codes</h2><p className="mt-3 text-[15px] text-muted-foreground">Each code takes a fixed amount off the publication fee at checkout. A person can use a code once.</p><div className="mt-4 grid gap-3 sm:grid-cols-5 sm:items-end"><div><label htmlFor="pc-code" className="mb-1 block text-sm font-medium">Code</label><Input id="pc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={32} /></div><div><label htmlFor="pc-off" className="mb-1 block text-sm font-medium">Amount off (₹)</label><Input id="pc-off" inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} /></div><div><label htmlFor="pc-max" className="mb-1 block text-sm font-medium">Max uses (optional)</label><Input id="pc-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} /></div><div><label htmlFor="pc-exp" className="mb-1 block text-sm font-medium">Expires (optional)</label><Input id="pc-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div><Button onClick={create} disabled={busy || code.trim().length < 3 || !rupees}>{busy ? "Creating…" : "Create code"}</Button></div><table className="rtable mt-5 w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2 font-medium">Code</th><th className="font-medium">Amount</th><th className="font-medium">Used</th><th className="font-medium">Expires</th><th className="font-medium">Action</th></tr></thead><tbody>{(promos ?? []).map((p) => <tr key={p.id} className="border-b border-border"><td data-label="Code" className="py-2.5 font-mono">{p.code}</td><td data-label="Amount" className="tabular-nums">{money(p.amount_off_minor, p.currency)}</td><td data-label="Used" className="tabular-nums">{p.redeemed}{p.max_redemptions ? ` / ${p.max_redemptions}` : ""}</td><td data-label="Expires">{p.expires_at ? fmtDate(p.expires_at) : "Never"}</td><td data-label="" className="text-right"><Button size="sm" variant="outline" onClick={() => toggle(p.id, !p.active)}>{p.active ? "Disable" : "Enable"}</Button></td></tr>)}</tbody></table>{promos?.length === 0 && <p className="py-4 text-muted-foreground">No promo codes yet.</p>}</section>);
}

function TestMode() {
  const navigate = useNavigate();
  const t = useQuery({ queryKey: ["admin-test"], queryFn: () => adminTestOverview(), retry: false });
  const [paperId, setPaperId] = useState("");
  const [busy, setBusy] = useState<"skip" | "paywall" | "pay" | "cert" | "testpub" | null>(null);
  const ledger = useQuery({ queryKey: ["admin-test-payments"], queryFn: () => adminTestPayments(), retry: false });
  const [pubCode, setPubCode] = useState("");
  const [wall, setWall] = useState<Awaited<ReturnType<typeof adminTestPaywall>> | null>(null);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  if (!t.data) return null;
  async function finish(promoCode?: string) {
    const r = await adminTestPayment({ data: { paperId, ...(promoCode ? { promoCode } : {}) } });
    toast.success("Test payment completed");
    await navigate({ to: "/my-research/$id", params: { id: r.paperId } });
  }
  async function skip() { setBusy("skip"); try { await finish(); } catch (e) { toast.error(e instanceof Error ? e.message : "Test payment failed"); setBusy(null); } }
  async function testPublish() {
    setBusy("testpub");
    try {
      const r = await adminTestPublish({ data: { paperId, ...(pubCode.trim() ? { promoCode: pubCode.trim() } : {}) } });
      toast.success("Test publish completed. The paper and certificate are marked Test.");
      await ledger.refetch();
      await navigate({ to: "/my-research/$id", params: { id: r.paperId } });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Test publish failed"); setBusy(null); }
  }
  async function openWall() { setBusy("paywall"); try { setWall(await adminTestPaywall({ data: { paperId } })); setCode(""); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not open the paywall"); } finally { setBusy(null); } }
  async function applyCode() { if (!code.trim()) return; setChecking(true); try { setWall(await adminTestPaywall({ data: { paperId, promoCode: code } })); toast.success("Promo code applied"); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not apply the promo code"); setWall((w) => (w ? { ...w, promo: null } : w)); } finally { setChecking(false); } }
  async function payWall() { setBusy("pay"); try { await finish(wall?.promo?.code); } catch (e) { toast.error(e instanceof Error ? e.message : "Test payment failed"); setBusy(null); } }
  async function certNow() { setBusy("cert"); try { const r = await adminTestCertificate({ data: { paperId } }); toast.success(`Certificate ${r.certificateId} ready`); window.location.assign(r.url); } catch (e) { toast.error(e instanceof Error ? e.message : "Test certificate failed"); } finally { setBusy(null); } }
  const payable = wall ? (wall.promo ? wall.promo.finalMinor : wall.amountMinor) : 0;
  return (<section aria-labelledby="test-h" className="mt-12"><h2 id="test-h" className="border-b border-border pb-2 text-[1.5rem]">Test mode</h2><p className="mt-3 max-w-[70ch] text-[15px] text-muted-foreground">Skip payment settles a test payment instantly. Test payment opens the paywall with the promo code box, then completes with the selected code or without it.</p><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"><div><label htmlFor="tm-paper" className="mb-1 block text-sm font-medium">Paper</label><select id="tm-paper" value={paperId} onChange={(e) => { setPaperId(e.target.value); setWall(null); }} className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px]">{<option value="">Choose a paper…</option>}{t.data.papers.map((p) => <option key={p.id} value={p.id}>{p.publicId} · {STATUS_LABEL[p.status] ?? p.status} · {p.title.slice(0, 60)}</option>)}</select></div><Button variant="outline" onClick={skip} disabled={!paperId || busy !== null}>{busy === "skip" ? "Paying…" : "Skip payment"}</Button><Button onClick={openWall} disabled={!paperId || busy !== null}>{busy === "paywall" ? "Opening…" : "Test payment"}</Button><Button variant="outline" onClick={certNow} disabled={!paperId || busy !== null}>{busy === "cert" ? "Preparing…" : "Test certificate"}</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><div><label htmlFor="tm-pubcode" className="mb-1 block text-sm font-medium">Promo code for Test publish (optional)</label><Input id="tm-pubcode" value={pubCode} onChange={(e) => setPubCode(e.target.value.toUpperCase())} placeholder="Leave empty for no code" maxLength={32} autoComplete="off" /></div><Button onClick={testPublish} disabled={!paperId || busy !== null}>{busy === "testpub" ? "Publishing…" : "Test publish"}</Button></div><p className="mt-2 max-w-[70ch] text-xs text-muted-foreground">Test publish works like Skip payment, but the paper title gets a [Test] prefix, the certificate is issued in the name Test, and the payment keeps the promo code, the discount and the amount received.</p>{ledger.data && ledger.data.length > 0 && (<div className="mt-6 max-w-full"><table className="rtable w-full text-left text-sm"><caption className="mb-2 text-left text-sm font-medium">Test payments</caption><thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3">Paper</th><th className="pr-3">Promo code</th><th className="pr-3">Price</th><th className="pr-3">Discount</th><th>Received</th></tr></thead><tbody>{ledger.data.map((r) => (<tr key={r.orderId} className="border-b border-border"><td data-label="Paper" className="py-1 pr-3">{r.publicId}</td><td data-label="Promo code" className="pr-3">{r.promoCode ?? "—"}</td><td data-label="Price" className="pr-3 tabular-nums">{money(r.originalMinor, r.currency)}</td><td data-label="Discount" className="pr-3 tabular-nums">{money(r.discountMinor, r.currency)}</td><td data-label="Received" className="tabular-nums">{money(r.receivedMinor, r.currency)}</td></tr>))}</tbody></table></div>)}{wall && (<div className="mt-6 max-w-xl border-2 border-primary p-5" role="group" aria-labelledby="tm-wall-h"><h3 id="tm-wall-h" className="text-[1.25rem] font-semibold">Publish this work <span className="ml-2 align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground">Test</span></h3><p className="mt-1 text-[15px] text-muted-foreground">{wall.publicId} · {wall.title}</p><div className="mt-4 flex items-end gap-2"><div className="flex-1"><label htmlFor="tm-promo" className="mb-1 block text-sm font-medium">Promo code</label><Input id="tm-promo" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setWall({ ...wall, promo: null }); }} placeholder="Enter code" maxLength={32} autoComplete="off" /></div><Button type="button" variant="outline" onClick={applyCode} disabled={checking || busy !== null || !code.trim()}>{checking ? "Checking…" : "Apply"}</Button></div>{wall.promo && <p className="mt-3 text-[15px]" role="status"><span className="tabular-nums text-muted-foreground line-through">{money(wall.amountMinor, wall.currency)}</span>{" "}<span className="font-semibold tabular-nums">{money(wall.promo.finalMinor, wall.currency)}</span>{" "}<span className="text-muted-foreground">({money(wall.promo.discountMinor, wall.currency)} off with {wall.promo.code})</span></p>}<div className="mt-4 flex flex-wrap gap-2"><Button onClick={payWall} disabled={busy !== null} size="lg">{busy === "pay" ? "Processing…" : `Pay ${money(payable, wall.currency)} (test)`}</Button><Button variant="ghost" onClick={() => setWall(null)} disabled={busy !== null}>Cancel</Button></div><p className="mt-3 text-xs text-muted-foreground">No card is charged. A promo code changes the amount here but is not used up.</p></div>)}</section>);
}

/** Refunds for rejected papers that did not go through automatically. Shows nothing when there are none. */
function FailedRefunds() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["admin-failed-refunds"], queryFn: () => adminListFailedRefunds(), retry: false });
  const [busyId, setBusyId] = useState<string | null>(null);
  if (error || !data || data.length === 0) return null;
  async function retry(paperId: string) {
    setBusyId(paperId);
    try { await adminRetryRefund({ data: { paperId } }); toast.success("Refund sent"); await qc.invalidateQueries({ queryKey: ["admin-failed-refunds"] }); void qc.invalidateQueries({ queryKey: ["admin"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Refund failed"); } finally { setBusyId(null); }
  }
  return (
    <Section title="Refunds that need attention" meta={String(data.length)}>
      <ul className="divide-y divide-border">
        {data.map((r) => (
          <li key={r.order_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
            <div className="min-w-0"><div className="break-words font-medium">{r.public_id} {r.title}</div><div className="text-sm text-muted-foreground">Order {r.order_id}, paid {money(r.amount_minor, r.currency)}. {r.refund_error}</div></div>
            <Button size="sm" disabled={busyId === r.paper_id} onClick={() => retry(r.paper_id)}>{busyId === r.paper_id ? "Refunding…" : "Retry refund"}</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
