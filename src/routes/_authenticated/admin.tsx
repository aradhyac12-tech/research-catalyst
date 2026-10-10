import { MANUSCRIPT_ACCEPT } from "@/lib/domain/file-security";
import { createFileRoute, Link } from "@tanstack/react-router";
import { adminQuery } from "@/lib/queries";
import { useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminTestOverview, adminTestPayment, adminTestPaywall, adminTestCertificate, adminPaperReport, adminPublish, adminListPromoCodes, adminCreatePromoCode, adminSetPromoCodeActive, adminListFailedRefunds, adminRetryRefund } from "@/lib/app.functions";
import { adminGetSettings, adminUpdateSettings, editorCloseReviews, editorDecide, editorExtendDeadline, editorInviteReviewer, editorListReviewers, editorReplaceReviewer, editorReviews, editorSetPublicationType, editorStartPeerReview } from "@/lib/review.functions";
import { adminAuditLog, adminConfirmBoardMember, adminDeleteBoardMember, adminGetIdentity, adminListBoard, adminSaveBoardMember, adminSaveIdentity } from "@/lib/identity.functions";
import { adminIssueNotice, myPaperReferences, validatePaperReferences } from "@/lib/scholarly.functions";
import { adminIssueCorrectedVersion } from "@/lib/versions.functions";
import { REFERENCE_STATUS_LABEL, type ReferenceStatus } from "@/lib/domain/references";
import { RoleManager } from "@/components/role-manager";
import { FeeWaivers } from "@/components/fee-waivers";
import { REVIEW_MODEL_LABEL } from "@/lib/domain/review";
import { AiMeter, type AiMeterData } from "@/components/ai-meter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PageTitle, StatusBadge, fmtDate, money } from "@/lib/ui";
import { STATUS_LABEL } from "@/lib/domain/constants";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Editorial | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Editorial | Paperly" }, { property: "og:type", content: "website" }] }),
  loader: ({ context }) => { void context.queryClient.prefetchQuery(adminQuery()); },
  component: Admin,
});

function Admin() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("review");
  const { data, error, isLoading } = useQuery(adminQuery());
  if (isLoading) return <div className="mx-auto max-w-5xl px-5 pt-10 text-muted-foreground">Loading…</div>;
  if (error || !data) return <div className="mx-auto max-w-5xl px-5 pt-10"><PageTitle title="Editorial" /><p role="alert" className="border-l-4 border-destructive bg-critical-soft px-4 py-3">Your account cannot access this panel.</p></div>;

  const TABS: { id: AdminTab; label: string; count?: number }[] = [
    { id: "review", label: "Review queue", count: data.queue.length },
    { id: "money", label: "Payments & promos" },
    { id: "people", label: "People & records" },
    { id: "tools", label: "Test tools" },
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-16 pt-8 sm:px-5 sm:pt-10">
      <PageTitle title="Admin" subtitle="Review queue, payments, people and platform tools" />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(data.byStatus).map(([s, n]) => (
          <div key={s} className="min-w-0 rounded border border-border bg-background px-4 py-3">
            <dt className="truncate text-sm text-muted-foreground">{STATUS_LABEL[s] ?? s}</dt>
            <dd className="text-[1.5rem] font-semibold tabular-nums">{String(n)}</dd>
          </div>
        ))}
      </dl>

      <div role="tablist" aria-label="Admin sections" className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((t) => (
          <button
            key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 ${tab === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-wash"}`}
          >
            {t.label}
            {t.count !== undefined && <span className={`rounded-full px-2 text-sm tabular-nums ${tab === t.id ? "bg-primary-foreground/20" : "bg-wash"}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0 space-y-6">
        {tab === "review" && (
          <Section title="Waiting for an editor" meta={`${data.queue.length} paper${data.queue.length === 1 ? "" : "s"}`}>
            <ul className="divide-y divide-border empty:hidden">
              {data.queue.map((p) => (
                <li key={p.id} className="min-w-0">
                  <button type="button" className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-4 text-left hover:bg-wash focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-5" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <div className="min-w-0"><div className="break-words text-sm text-muted-foreground">{p.public_id}, {p.article_type}, submitted {fmtDate(p.created_at)}</div><div className="mt-1 break-words font-serif text-[1.125rem] leading-snug">{p.title}</div></div>
                    <StatusBadge status={p.status} />
                  </button>
                  {open === p.id && <div className="min-w-0 px-4 pb-4 sm:px-5"><Review id={p.id} status={p.status} canDecide={["REVIEW_REQUIRED", "EDITORIAL_DECISION"].includes(p.status)} canPublish={p.status === "PUBLICATION_PENDING"} onDone={() => { void qc.invalidateQueries({ queryKey: ["admin"] }); void qc.invalidateQueries({ queryKey: ["admin-paper", p.id] }); }} onClose={() => setOpen(null)} /></div>}
                </li>
              ))}
            </ul>
            {data.queue.length === 0 && <p className="px-5 py-8 text-muted-foreground">Nothing is waiting for review.</p>}
          </Section>
        )}

        {tab === "money" && (
          <>
            <Section title="Recent payments">
              <div className="max-w-full overflow-x-auto px-4 py-4 sm:px-5">
                <table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2 font-medium">Order</th><th className="font-medium">Amount</th><th className="font-medium">Status</th><th className="font-medium">Date</th></tr></thead><tbody>{data.payments.map((p) => <tr key={p.order_id} className="border-b border-border"><td className="py-2.5 tabular-nums">{p.order_id}</td><td className="tabular-nums">{money(p.amount_minor, p.currency)}</td><td className="py-2.5"><StatusBadge status={p.status} /></td><td className="py-2.5 text-muted-foreground">{fmtDate(p.created_at)}</td></tr>)}</tbody></table>
              </div>
            </Section>
            <FailedRefunds />
            <Section title="Promo codes" defaultOpen={false}>
              <div className="min-w-0 px-4 py-4 sm:px-5"><PromoAdmin /></div>
            </Section>
          </>
        )}

        {tab === "people" && (
          <>
            <Section title="People & access">
              <div className="min-w-0 px-4 py-4 sm:px-5"><AdminPanel /></div>
            </Section>
            <Section title="Activity log" defaultOpen={false}>
              <div className="min-w-0 px-4 py-4 sm:px-5"><AuditPanel /></div>
            </Section>
          </>
        )}

        {tab === "tools" && (
          <Section title="Test tools" meta="Admin only">
            <div className="min-w-0 px-4 py-4 sm:px-5"><TestMode /><FeeWaivers /></div>
          </Section>
        )}
      </div>
    </div>
  );
}

type AdminTab = "review" | "money" | "people" | "tools";

/** Expandable card. Content never widens the page: min-w-0 + overflow guard. */
function Section({ title, meta, defaultOpen = true, children }: { title: string; meta?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded border border-border bg-background">
      <h2 className="m-0">
        <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => setIsOpen((v) => !v)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-wash focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-5">
          <span className="min-w-0 break-words text-[1.2rem] font-semibold">{title}</span>
          <span className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">{meta && <span>{meta}</span>}<span aria-hidden="true" className={`inline-block transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}>▾</span></span>
        </button>
      </h2>
      {isOpen && <div id={id} className="min-w-0 max-w-full overflow-x-auto border-t border-border">{children}</div>}
    </section>
  );
}

const QUICK_REASONS: Record<"ACCEPT" | "REJECT" | "MINOR_REVISION" | "MAJOR_REVISION", string[]> = {
  ACCEPT: ["Meets scope and quality standards.", "Sound methodology, clear contribution, ready as submitted."],
  MINOR_REVISION: ["Promising, but needs small clarifications before acceptance.", "Address reviewer comments on wording and formatting."],
  MAJOR_REVISION: ["Substantial gaps in methodology need to be addressed.", "Core argument needs stronger evidence before reconsideration."],
  REJECT: ["Outside the scope of this publication.", "Does not meet the required methodological standard."],
};

const field = "flex h-11 w-full rounded-[2px] border border-input bg-background px-3 text-base";

function Review({ id, status, canDecide, canPublish, onDone, onClose }: { id: string; status: string; canDecide: boolean; canPublish: boolean; onDone: () => void; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["admin-paper", id], queryFn: () => adminPaperReport({ data: { id } }) });
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<"ACCEPT" | "REJECT" | "MINOR_REVISION" | "MAJOR_REVISION" | null>(null);
  async function decide(outcome: "ACCEPT" | "REJECT" | "MINOR_REVISION" | "MAJOR_REVISION") {
    setBusy(true); setPending(outcome);
    try { await editorDecide({ data: { paperId: id, outcome, ...(reason.trim() ? { reason } : {}) } }); toast.success("Decision recorded"); onDone(); onClose(); }
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
      <p className="border-l-4 border-border bg-background px-3 py-2 text-xs text-muted-foreground">Automated screening is information to help the editor. It is not peer review and not an editorial decision. It is a prompt for human review.</p>
      {data.run && <p className="text-xs text-muted-foreground">Screened by {data.run.model} under {data.run.policy}.</p>}
      <ul className="divide-y divide-border border-y border-border bg-background">
        {data.findings.map((f) => (
          <li key={f.check_key} className="px-4 py-3 text-[15px]"><div className="flex justify-between gap-3"><span className="font-semibold">{f.check_key.replace("_", " ")}</span><span className="text-xs uppercase tracking-wide text-muted-foreground">{f.status}</span></div>{f.message && <p className="mt-1 text-sm text-muted-foreground">{f.message}</p>}{f.evidence.filter((e) => e.quote).slice(0, 2).map((e, i) => <blockquote key={i} className="mt-2 border-l-2 border-border pl-3 text-xs italic text-muted-foreground">“{e.quote}”</blockquote>)}</li>
        ))}
      </ul>
      {meter && <AiMeter meter={meter} />}
      <PeerReviewPanel paperId={id} status={status} onChanged={onDone} />
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
            <Button size="lg" disabled={busy} onClick={() => decide("ACCEPT")} variant="positive" className="rounded-full">{pending === "ACCEPT" ? "Approving…" : "✓ Approve"}</Button>
            <Button size="lg" disabled={busy} variant="outline" onClick={() => decide("MINOR_REVISION")} className="rounded-full">{pending === "MINOR_REVISION" ? "Sending…" : "Minor revision"}</Button>
            <Button size="lg" disabled={busy} variant="outline" onClick={() => decide("MAJOR_REVISION")} className="rounded-full">{pending === "MAJOR_REVISION" ? "Sending…" : "Major revision"}</Button>
            <Button size="lg" disabled={busy} variant="destructive" onClick={() => decide("REJECT")} className="rounded-full">{pending === "REJECT" ? "Rejecting…" : "✕ Disapprove"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">One tap on a reason chip fills the box — review it, then hit the verdict button. The author sees this text.</p>
        </div>
      )}
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
  const inReview = ["REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"].includes(status);
  const done = d.reviews.filter((r) => r.status === "COMPLETED").length;
  return (
    <section className="space-y-4 border-l-4 border-border bg-background p-4" aria-label="Peer review">
      <h3 className="text-[1.0625rem]">Editorial handling</h3>
      <p><Link to="/manuscript/$paperId" params={{ paperId }} className="link text-sm font-medium">Open the manuscript in the browser with tracked changes</Link></p>
      <p className="text-sm text-muted-foreground">Record type: <span className="font-medium text-foreground">{d.paper.publication_type.replace(/_/g, " ").toLowerCase()}</span>. Peer review model: <span className="font-medium text-foreground">{REVIEW_MODEL_LABEL[d.paper.review_model] ?? d.paper.review_model}</span>.</p>
      {status === "REVIEW_REQUIRED" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">Record type<select className={field} value={d.paper.publication_type} disabled={busy} onChange={(e) => run(() => editorSetPublicationType({ data: { paperId, type: e.target.value as "REPOSITORY_RECORD" | "PREPRINT" | "JOURNAL_ARTICLE" } }), "Record type updated")}><option value="REPOSITORY_RECORD">Repository record</option><option value="PREPRINT">Preprint</option><option value="JOURNAL_ARTICLE" disabled={!d.journalMode}>Journal article{d.journalMode ? "" : " (journal mode is off)"}</option></select></label>
          {d.paper.publication_type === "JOURNAL_ARTICLE" && <Button variant="outline" disabled={busy} onClick={() => run(() => editorStartPeerReview({ data: { paperId } }), "Peer review started")}>Start peer review</Button>}
        </div>
      )}
      {d.reviews.length > 0 && (
        <ul className="divide-y divide-border border-y border-border text-[15px]">
          {d.reviews.map((r) => (
            <li key={r.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.reviewer_name}{r.reviewer_institution ? `, ${r.reviewer_institution}` : ""}</span><span className="text-xs text-muted-foreground uppercase tracking-wide">{r.status}</span></div>
              {r.coi_status && r.coi_status !== "NONE" && <p className="text-sm text-caution">Conflict of interest: {r.coi_status.toLowerCase()}{r.coi_statement ? `, ${r.coi_statement}` : ""}</p>}
              {r.status === "COMPLETED" && <><p className="text-sm">Recommendation: <span className="font-semibold">{String(r.recommendation).replace(/_/g, " ").toLowerCase()}</span></p><p className="text-xs text-muted-foreground">{r.comments}</p></>}
              {["INVITED", "ACCEPTED"].includes(r.status) && (
                <div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => editorExtendDeadline({ data: { assignmentId: r.id, days: 7 } }), "Deadline extended by 7 days")}>Extend</Button>{pick && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => editorReplaceReviewer({ data: { assignmentId: r.id, newReviewerId: pick } }), "Reviewer replaced")}>Replace</Button>}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {inReview && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Invite or choose a reviewer<select className={field} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Select…</option>{(reviewers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}{r.institution ? `, ${r.institution}` : ""}</option>)}</select></label>
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
        fd.append("paperlyId", f.paperlyId.trim()); fd.append("file", fixed); fd.append("notice", f.notice); fd.append("reason", f.reason);
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
  return (<div><h2 className="border-b border-border pb-2 text-[1.5rem]">Journal identity</h2><p className="mt-3 max-w-[70ch] text-[15px]">Leave the ISSN fields empty until an official ISSN has been assigned to this publication. An ISSN is shown publicly only after you confirm it was officially assigned.</p><div className="mt-4 grid max-w-2xl gap-4"><label className="block text-sm font-medium">Title<input className={field} value={v.journal_title} onChange={(e) => set("journal_title", e.target.value)} /></label><label className="block text-sm font-medium">Publisher<input className={field} value={v.publisher_name} onChange={(e) => set("publisher_name", e.target.value)} /></label><label className="block text-sm font-medium">Aims and scope (replaces the default text on the About page)<Textarea rows={5} value={v.aims_scope} onChange={(e) => set("aims_scope", e.target.value)} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block font-medium">Publication frequency<input className={field} value={v.publication_frequency} onChange={(e) => set("publication_frequency", e.target.value)} /></label><label className="block font-medium">Editorial office email<input className={field} type="email" value={v.editorial_office_email} onChange={(e) => set("editorial_office_email", e.target.value)} /></label></div><label className="block text-sm font-medium">Editorial office address<Textarea rows={2} value={v.editorial_office_address} onChange={(e) => set("editorial_office_address", e.target.value)} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">ISSN (print)<input className={field} placeholder="NNNN-NNNN" value={v.issn} onChange={(e) => set("issn", e.target.value)} /></label><label className="block text-sm font-medium">ISSN (online)<input className={field} placeholder="NNNN-NNNN" value={v.eissn} onChange={(e) => set("eissn", e.target.value)} /></label></div>{(v.issn || v.eissn) && <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={assigned} onChange={(e) => setAssigned(e.target.checked)} /><span>Officially assigned</span></label>}<div><Button disabled={busy} onClick={save}>Save identity</Button></div></div></div>);
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
  return (<div><form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(filters); setPage(1); }}><label className="text-sm font-medium">Action contains<input className={field} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} placeholder="decision, payment…" /></label><label className="text-sm font-medium">Resource<input className={field} value={filters.resource} onChange={(e) => setFilters({ ...filters, resource: e.target.value })} placeholder="paper id or resource" /></label><Button type="submit" variant="outline">Filter</Button></form><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border"><th className="py-2 pr-3">Time</th><th className="pr-3">Action</th><th className="pr-3">Resource</th><th>Change</th></tr></thead><tbody>{(q.data?.rows ?? []).map((r) => <tr key={r.id} className="border-b border-border align-top"><td className="py-2 pr-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td><td className="pr-3">{r.action}</td><td className="pr-3 break-all">{r.resource_type} {r.resource_id?.slice(0, 13)}</td><td className="break-all text-muted-foreground">{r.old_value ? JSON.stringify(r.old_value) : ""}{r.old_value || r.new_value ? " → " : ""}{r.new_value ? JSON.stringify(r.new_value) : ""}</td></tr>)}</tbody></table></div><div className="mt-3 flex items-center justify-between text-sm"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>);
}

function AdminPanel() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["editorial-settings"], queryFn: () => adminGetSettings(), retry: false });
  const [busy, setBusy] = useState(false);
  if (!s.data) return null;
  async function save(patch: Parameters<typeof adminUpdateSettings>[0]["data"]) {
    setBusy(true);
    try { await adminUpdateSettings({ data: patch }); toast.success("Saved"); await qc.invalidateQueries({ queryKey: ["editorial-settings"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  const d = s.data;
  return (
    <div className="space-y-8">
      <div><h2 className="border-b border-border pb-2 text-[1.5rem]">Publication settings</h2><div className="mt-4 space-y-4 text-[15px]"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={d.journal_mode_enabled} disabled={busy} onChange={(e) => save({ journal_mode_enabled: e.target.checked })} /><span>Journal mode enabled</span></label><label className="block max-w-md font-medium">Default review model<select className={field} value={d.default_review_model} disabled={busy} onChange={(e) => save({ default_review_model: e.target.value as "DOUBLE_ANONYMOUS" })}>{Object.entries(REVIEW_MODEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><div className="grid max-w-md gap-4 sm:grid-cols-2"><label className="block font-medium">Reviews required<input type="number" min={1} max={5} className={field} defaultValue={d.reviews_required} disabled={busy} onBlur={(e) => save({ reviews_required: Number(e.target.value) })} /></label><label className="block font-medium">Review days<input type="number" min={3} max={90} className={field} defaultValue={d.review_days} disabled={busy} onBlur={(e) => save({ review_days: Number(e.target.value) })} /></label></div></div></div>
      <RoleManager />
      <NoticePanel />
      <IdentityPanel />
      <BoardPanel />
    </div>
  );
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
  return (<section aria-labelledby="promo-h"><h2 id="promo-h" className="mt-12 border-b border-border pb-2 text-[1.5rem]">Promo codes</h2><p className="mt-3 text-[15px] text-muted-foreground">Each code takes a fixed amount off the publication fee at checkout. A person can use a code once.</p><div className="mt-4 grid gap-3 sm:grid-cols-5 sm:items-end"><div><label htmlFor="pc-code" className="mb-1 block text-sm font-medium">Code</label><Input id="pc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={32} /></div><div><label htmlFor="pc-off" className="mb-1 block text-sm font-medium">Amount off (₹)</label><Input id="pc-off" inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} /></div><div><label htmlFor="pc-max" className="mb-1 block text-sm font-medium">Max uses (optional)</label><Input id="pc-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} /></div><div><label htmlFor="pc-exp" className="mb-1 block text-sm font-medium">Expires (optional)</label><Input id="pc-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div><Button onClick={create} disabled={busy || code.trim().length < 3 || !rupees}>{busy ? "Creating…" : "Create code"}</Button></div><table className="mt-5 w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2 font-medium">Code</th><th className="font-medium">Amount</th><th className="font-medium">Used</th><th className="font-medium">Expires</th><th className="font-medium">Action</th></tr></thead><tbody>{(promos ?? []).map((p) => <tr key={p.id} className="border-b border-border"><td className="py-2.5 font-mono">{p.code}</td><td className="tabular-nums">{money(p.amount_off_minor, p.currency)}</td><td className="tabular-nums">{p.redeemed}{p.max_redemptions ? ` / ${p.max_redemptions}` : ""}</td><td>{p.expires_at ? fmtDate(p.expires_at) : "Never"}</td><td className="text-right"><Button size="sm" variant="outline" onClick={() => toggle(p.id, !p.active)}>{p.active ? "Disable" : "Enable"}</Button></td></tr>)}</tbody></table>{promos?.length === 0 && <p className="py-4 text-muted-foreground">No promo codes yet.</p>}</section>);
}

function TestMode() {
  const navigate = useNavigate();
  const t = useQuery({ queryKey: ["admin-test"], queryFn: () => adminTestOverview(), retry: false });
  const [paperId, setPaperId] = useState("");
  const [busy, setBusy] = useState<"skip" | "paywall" | "pay" | "cert" | null>(null);
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
  async function openWall() { setBusy("paywall"); try { setWall(await adminTestPaywall({ data: { paperId } })); setCode(""); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not open the paywall"); } finally { setBusy(null); } }
  async function applyCode() { if (!code.trim()) return; setChecking(true); try { setWall(await adminTestPaywall({ data: { paperId, promoCode: code } })); toast.success("Promo code applied"); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not apply the promo code"); setWall((w) => (w ? { ...w, promo: null } : w)); } finally { setChecking(false); } }
  async function payWall() { setBusy("pay"); try { await finish(wall?.promo?.code); } catch (e) { toast.error(e instanceof Error ? e.message : "Test payment failed"); setBusy(null); } }
  async function certNow() { setBusy("cert"); try { const r = await adminTestCertificate({ data: { paperId } }); toast.success(`Certificate ${r.certificateId} ready`); window.location.assign(r.url); } catch (e) { toast.error(e instanceof Error ? e.message : "Test certificate failed"); } finally { setBusy(null); } }
  const payable = wall ? (wall.promo ? wall.promo.finalMinor : wall.amountMinor) : 0;
  return (<section aria-labelledby="test-h" className="mt-12"><h2 id="test-h" className="border-b border-border pb-2 text-[1.5rem]">Test mode</h2><p className="mt-3 max-w-[70ch] text-[15px] text-muted-foreground">Skip payment settles a test payment instantly. Test payment opens the paywall with the promo code box, then completes with the selected code or without it.</p><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"><div><label htmlFor="tm-paper" className="mb-1 block text-sm font-medium">Paper</label><select id="tm-paper" value={paperId} onChange={(e) => { setPaperId(e.target.value); setWall(null); }} className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px]">{<option value="">Choose a paper…</option>}{t.data.papers.map((p) => <option key={p.id} value={p.id}>{p.publicId} · {STATUS_LABEL[p.status] ?? p.status} · {p.title.slice(0, 60)}</option>)}</select></div><Button variant="outline" onClick={skip} disabled={!paperId || busy !== null}>{busy === "skip" ? "Paying…" : "Skip payment"}</Button><Button onClick={openWall} disabled={!paperId || busy !== null}>{busy === "paywall" ? "Opening…" : "Test payment"}</Button><Button variant="outline" onClick={certNow} disabled={!paperId || busy !== null}>{busy === "cert" ? "Preparing…" : "Test certificate"}</Button></div>{wall && (<div className="mt-6 max-w-xl border-2 border-primary p-5" role="group" aria-labelledby="tm-wall-h"><h3 id="tm-wall-h" className="text-[1.25rem] font-semibold">Publish this work <span className="ml-2 align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground">Test</span></h3><p className="mt-1 text-[15px] text-muted-foreground">{wall.publicId} · {wall.title}</p><div className="mt-4 flex items-end gap-2"><div className="flex-1"><label htmlFor="tm-promo" className="mb-1 block text-sm font-medium">Promo code</label><Input id="tm-promo" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setWall({ ...wall, promo: null }); }} placeholder="Enter code" maxLength={32} autoComplete="off" /></div><Button type="button" variant="outline" onClick={applyCode} disabled={checking || busy !== null || !code.trim()}>{checking ? "Checking…" : "Apply"}</Button></div>{wall.promo && <p className="mt-3 text-[15px]" role="status"><span className="tabular-nums text-muted-foreground line-through">{money(wall.amountMinor, wall.currency)}</span>{" "}<span className="font-semibold tabular-nums">{money(wall.promo.finalMinor, wall.currency)}</span>{" "}<span className="text-muted-foreground">({money(wall.promo.discountMinor, wall.currency)} off with {wall.promo.code})</span></p>}<div className="mt-4 flex flex-wrap gap-2"><Button onClick={payWall} disabled={busy !== null} size="lg">{busy === "pay" ? "Processing…" : `Pay ${money(payable, wall.currency)} (test)`}</Button><Button variant="ghost" onClick={() => setWall(null)} disabled={busy !== null}>Cancel</Button></div><p className="mt-3 text-xs text-muted-foreground">No card is charged. A promo code changes the amount here but is not used up.</p></div>)}</section>);
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
