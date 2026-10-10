import { formatBytes } from "@/lib/format";
import { MANUSCRIPT_ACCEPT } from "@/lib/domain/file-security";
import { createFileRoute, Link } from "@tanstack/react-router";
import { myPaperQuery, meQuery } from "@/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { retryScreening, startScreening } from "@/lib/app.functions";
import { addAnonymizedCopy, getMyReviews, submitRevision, withdrawMyPaper } from "@/lib/review.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AiMeter, type AiMeterData } from "@/components/ai-meter";
import { RazorpayPay } from "@/components/razorpay-checkout";
import { SUBMISSION_FEE_RETAINED_MINOR } from "@/lib/domain/fees";
import { Facts, StatusBadge, fmtDate, money } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { CertificateDelivery } from "@/components/certificate-delivery";
import { getPaperVersions } from "@/lib/versions.functions";

export const Route = createFileRoute("/_authenticated/my-research/$id")({
  head: () => ({ meta: [{ title: "Submission | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Submission | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context, params }) => { void context.queryClient.prefetchQuery(myPaperQuery(params.id)); void context.queryClient.prefetchQuery(meQuery()); },
  component: PaperReport,
});

// Order of the new flow: the fee is paid right after upload, and screening starts only once it is paid.
const STAGES = ["Submitted", "Payment", "Screening", "Editorial", "Published"] as const;
function stageIndex(s: string, feeCleared: boolean) {
  if (s === "DRAFT") return 0;
  if (s === "SUBMITTED") return feeCleared ? 2 : 1; // unpaid: waiting at Payment; paid: screening is about to run
  if (s === "PAYMENT_PENDING") return 1; // older papers that reached acceptance without paying
  if (["PROCESSING", "AI_SCREENING"].includes(s)) return 2;
  if (["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION", "REVISION_REQUIRED", "REJECTED", "ACCEPTED", "WITHDRAWN"].includes(s)) return 3;
  return 4; // PAYMENT_COMPLETED, PUBLICATION_PENDING, PUBLISHED and later
}

const CHECK_LABEL: Record<string, string> = {
  document: "Document integrity", authorship: "Authorship", copyright: "Copyright & permissions", similarity: "Similarity",
  citations: "References", methodology: "Methodology", statistics: "Statistics", ethics: "Research ethics",
  data_consistency: "Data consistency", figures: "Figures & tables", ai_content: "AI-generated text",
};
const STATUS_STYLE: Record<string, string> = {
  PASS: "bg-positive-soft text-positive", WARNING: "bg-caution-soft text-caution",
  REVIEW_REQUIRED: "bg-caution-soft text-caution", FAIL: "bg-critical-soft text-destructive",
  NOT_APPLICABLE: "bg-wash text-muted-foreground",
};
const STATUS_TEXT: Record<string, string> = { PASS: "Passed", WARNING: "Note", REVIEW_REQUIRED: "Needs review", FAIL: "Failed", NOT_APPLICABLE: "Not applicable" };

function PaperReport() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ ...myPaperQuery(id), refetchInterval: (q) => ["PROCESSING", "AI_SCREENING", "SUBMITTED"].includes(q.state.data?.paper.status ?? "") ? 4000 : false });
  const me = useQuery(meQuery());

  const started = useRef(false);
  useEffect(() => {
    if (data?.paper.status === "SUBMITTED" && data.feePaid && !started.current) {
      started.current = true;
      void startScreening({ data: { id } }).finally(() => qc.invalidateQueries({ queryKey: ["my-paper", id] }));
    }
  }, [data?.paper.status, data?.feePaid, id, qc]);

  if (isLoading) return <div className="mx-auto max-w-4xl px-5 pt-10 text-muted-foreground">Loading…</div>;
  if (error || !data) return <div className="mx-auto max-w-4xl px-5 pt-10"><p role="alert" className="font-semibold">This submission could not be found.</p><Link to="/my-research" className="link">Back to my research</Link></div>;

  const { paper, screening, decisions, payments, authors, price, methods } = data;
  // Only a human editorial decision is shown as "Decision". The automated routing row is shown as screening flags.
  const decision = decisions.find((d) => d.source === "HUMAN");
  const flags = decisions.find((d) => d.source === "MACHINE");
  const reasons = (Array.isArray(flags?.reasons) ? flags.reasons : []) as Array<{ code: string; outcome: string; message: string }>;
  const decisionNotes = (Array.isArray(decision?.reasons) ? decision.reasons : []) as Array<{ code: string; message: string }>;
  const { feePaid } = data;
  const stage = stageIndex(paper.status, feePaid);
  const payAtUpload = paper.status === "SUBMITTED" && !feePaid; // paywall: screening has not started
  const canPay = payAtUpload || (["ACCEPTED", "PAYMENT_PENDING"].includes(paper.status) && !feePaid);
  const meter = (screening?.aiMeter ?? null) as AiMeterData | null;
  const cites = (screening?.citations ?? null) as { checked: number; invalid: number; details: string[] } | null;
  const running = ["PROCESSING", "AI_SCREENING"].includes(paper.status) || (paper.status === "SUBMITTED" && feePaid);

  return (
    <div className="mx-auto max-w-4xl px-5 pt-8">
      <Link to="/my-research" className="link text-[15px]">Back to my research</Link>
      <h1 className="mt-4 text-[2rem] leading-tight">{paper.title}</h1>
      <p className="mt-3 text-[15px] text-muted-foreground">{authors.map((a) => a.full_name).join(", ")}</p>
      <div className="mt-5"><Facts items={[
        ["Status", <StatusBadge key="s" status={payAtUpload ? "PAYMENT_PENDING" : paper.status} />],
        ["Reference", <span key="r" className="tabular-nums">{paper.public_id}</span>],
        ["Type", paper.article_type],
        ["Submitted", fmtDate(paper.created_at)],
      ]} /></div>

      <ol className="mt-8 grid grid-cols-5 gap-1.5" aria-label="Progress">
        {STAGES.map((s, i) => (
          <li key={s} aria-current={i === stage ? "step" : undefined}>
            <div className={cn("h-1.5", i < stage ? "bg-primary" : i === stage ? "bg-primary/50" : "bg-wash")} />
            <div className={cn("mt-1.5 text-[13px]", i === stage ? "font-semibold" : i < stage ? "" : "text-muted-foreground")}>{s}</div>
          </li>
        ))}
      </ol>

      {running && (
        <div role="status" className="mt-8 border-l-4 border-primary bg-accent px-4 py-3 text-[15px]">
          <p className="font-semibold">Screening is running</p>
          <p className="mt-1">This page updates by itself. You can close it and come back. <button className="link font-medium" onClick={async () => { try { await retryScreening({ data: { id } }); qc.invalidateQueries({ queryKey: ["my-paper", id] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Screening could not be restarted"); } }}>Restart screening</button> if nothing changes after several minutes.</p>
        </div>
      )}

      {decision && (
        <section className="mt-10" aria-labelledby="decision-h">
          <h2 id="decision-h" className="border-b border-border pb-2 text-[1.5rem]">Editorial decision</h2>
          <p className="mt-3 text-[15px] text-muted-foreground">Recorded by a human editor on {fmtDate(decision.created_at)}: <span className="font-semibold text-foreground">{decision.outcome === "REVISION_REQUIRED" ? "Revision requested" : decision.outcome === "ACCEPT" ? "Accepted" : "Not accepted"}</span>.</p>
          {decisionNotes.map((n, i) => <p key={i} className="mt-3 max-w-[70ch] whitespace-pre-line">{n.message}</p>)}
        </section>
      )}

      {["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"].includes(paper.status) && (
        <p className="mt-8 text-[15px]"><Link to="/manuscript/$paperId" params={{ paperId: id }} className="link font-medium">See the editor's tracked changes to your title, abstract and keywords, and accept or reject them</Link></p>
      )}
      <ReviewsSection paperId={id} status={paper.status} />
      <VersionHistory paperId={id} status={paper.status} />

      {flags && (
        <section className="mt-10" aria-labelledby="flags-h">
          <h2 id="flags-h" className="border-b border-border pb-2 text-[1.5rem]">Automated screening flags</h2>
          <p className="mt-3 text-[15px] text-muted-foreground">Information for the editor, recorded {fmtDate(flags.created_at)}. Automated screening is not peer review and is not a decision.</p>
          {reasons.length === 0 ? <p className="mt-3">No flags were raised.</p> : (
            <ul className="mt-3 divide-y divide-border border-y border-border">{reasons.map((r, i) => <li key={i} className="py-3 text-[15px]">{r.message}</li>)}</ul>
          )}
        </section>
      )}

      {canPay && (
        <section className="mt-10 border-2 border-primary p-5" aria-labelledby="pay-h">
          <h2 id="pay-h" className="text-[1.5rem]">{payAtUpload ? "Pay the submission fee to start screening" : "Publish this work"}</h2>
          {payAtUpload
            ? <p className="mt-2 max-w-[62ch]">Your manuscript is uploaded. Screening starts as soon as the fee is paid. Have a promo code? Enter it below to reduce the amount. If the paper is rejected, {money(SUBMISSION_FEE_RETAINED_MINOR, "INR")} is kept and the rest of what you paid is refunded to your original payment method. The fee does not influence the editorial decision.</p>
            : <p className="mt-2 max-w-[62ch]">An editor has accepted your manuscript. The fee covers hosting and a permanent public record. It did not influence the decision.</p>}
          <p className="mt-4 text-[2rem] font-semibold tabular-nums">{price ? money(price.amountMinor, price.currency) : "Not available"}</p>
          <p className="text-[15px] text-muted-foreground">You can pay by UPI, card or netbanking. Card details go to Razorpay and never reach Paperly.</p>
          <div className="mt-5">
            {methods.RAZORPAY && price
              ? <RazorpayPay paperId={paper.id} amountMinor={price.amountMinor} currency={price.currency} email={me.data?.profile?.email} name={me.data?.profile?.display_name} onPaid={async () => { await qc.invalidateQueries({ queryKey: ["my-paper", id] }); if (payAtUpload) { started.current = true; void startScreening({ data: { id } }).finally(() => qc.invalidateQueries({ queryKey: ["my-paper", id] })); } }} />
              : <p className="font-semibold">Online payment is not open yet. You will be notified when it is.</p>}
          </div>
        </section>
      )}

      {screening && (
        <section className="mt-12" aria-labelledby="report-h">
          <h2 id="report-h" className="border-b border-border pb-2 text-[1.5rem]">Screening report</h2>
          {screening.findings.length === 0 ? (
            <p className="mt-3 text-muted-foreground">No AI findings are on file. Either AI screening was not consented to or it did not complete.</p>
          ) : (
            <table className="mt-1 w-full text-left text-[15px]">
              <caption className="sr-only">Result of each screening check</caption>
              <thead><tr className="border-b border-border text-muted-foreground"><th scope="col" className="py-2 pr-4 font-medium">Check</th><th scope="col" className="py-2 pr-4 font-medium">Result</th><th scope="col" className="hidden py-2 font-medium sm:table-cell">Note</th></tr></thead>
              <tbody>
                {screening.findings.map((f) => (
                  <tr key={f.check_key} className="border-b border-border align-top">
                    <th scope="row" className="py-2.5 pr-4 font-semibold">{CHECK_LABEL[f.check_key] ?? f.check_key}</th>
                    <td className="py-2.5 pr-4"><span className={cn("inline-block rounded-[2px] px-2 py-0.5 text-sm font-medium", STATUS_STYLE[f.status])}>{STATUS_TEXT[f.status] ?? f.status}</span></td>
                    <td className="hidden py-2.5 text-muted-foreground sm:table-cell">{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {cites && <p className="mt-4 text-[15px]">References: {cites.checked} DOIs checked against Crossref, {cites.invalid} not found.{cites.details.length > 0 && <span className="text-muted-foreground"> {cites.details.slice(0, 3).join("; ")}{cites.details.length > 3 ? "…" : ""}</span>}</p>}
          {meter && <AiMeter meter={meter} audience="author" className="mt-10" />}
        </section>
      )}

      {payments.length > 0 && (
        <section className="mt-12" aria-labelledby="pay-hist-h">
          <h2 id="pay-hist-h" className="border-b border-border pb-2 text-[1.5rem]">Payments</h2>
          <table className="w-full text-left text-[15px]"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-4 font-medium">Order</th><th className="py-2 pr-4 font-medium">Amount</th><th className="py-2 pr-4 font-medium">Status</th><th className="py-2 text-right font-medium">Date</th></tr></thead>
            <tbody>{payments.map((p) => <tr key={p.order_id} className="border-b border-border"><td className="py-2.5 pr-4 tabular-nums">{p.order_id}</td><td className="py-2.5 pr-4 tabular-nums">{money(p.amount_minor, p.currency)}</td><td className="py-2.5 pr-4"><StatusBadge status={p.status} /></td><td className="py-2.5 text-right">{fmtDate(p.completed_at ?? p.created_at)}</td></tr>)}</tbody></table>
        </section>
      )}
      <section className="mt-12 pb-10" aria-labelledby="certificate-h">
        <h2 id="certificate-h" className="mb-4 border-b border-border pb-2 text-[1.5rem]">Certificates</h2>
        <CertificateDelivery paperId={id} />
      </section>
    </div>
  );
}

const REC_LABEL: Record<string, string> = { ACCEPT: "Accept", MINOR_REVISION: "Minor revision", MAJOR_REVISION: "Major revision", REJECT: "Reject" };

function ReviewsSection({ paperId, status }: { paperId: string; status: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["my-reviews", paperId, status], queryFn: () => getMyReviews({ data: { paperId } }) });
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [anon, setAnon] = useState<File | null>(null);
  const [summary, setSummary] = useState(""); const [response, setResponse] = useState(""); const [reason, setReason] = useState("");
  async function revise() {
    if (!file) { toast.error("Attach the revised manuscript."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("paperId", paperId); fd.append("file", file); if (anon) fd.append("anonymized_file", anon);
      fd.append("summary", summary); fd.append("response", response);
      const r = await submitRevision({ data: fd });
      toast.success(`Version ${r.version} submitted`);
      qc.invalidateQueries({ queryKey: ["my-paper", paperId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit the revision"); } finally { setBusy(false); }
  }
  async function withdraw() {
    if (reason.trim().length < 10) { toast.error("Give a reason of at least 10 characters."); return; }
    setBusy(true);
    try { await withdrawMyPaper({ data: { paperId, reason } }); toast.success("Submission withdrawn"); qc.invalidateQueries({ queryKey: ["my-paper", paperId] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not withdraw"); } finally { setBusy(false); }
  }
  async function addAnon(f: File | null) {
    if (!f) return;
    setBusy(true);
    try { const fd = new FormData(); fd.append("paperId", paperId); fd.append("file", f); await addAnonymizedCopy({ data: fd }); toast.success("Anonymized copy saved"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save the anonymized copy"); } finally { setBusy(false); }
  }
  const canWithdraw = ["SUBMITTED", "REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION", "REVISION_REQUIRED"].includes(status);
  return (
    <>
      {data?.visible && data.reviews.length > 0 && (
        <section className="mt-10" aria-labelledby="reviews-h">
          <h2 id="reviews-h" className="border-b border-border pb-2 text-[1.5rem]">Peer reviews</h2>
          <p className="mt-3 text-[15px] text-muted-foreground">Review model: {String(data.review_model ?? "").replace(/_/g, " ").toLowerCase()}. Reviewer identities are shown only under open review.</p>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {data.reviews.map((r, i) => (
              <li key={i} className="py-4">
                <p className="text-sm text-muted-foreground">{r.reviewer}, round {r.round}{r.recommendation ? `, recommends: ${REC_LABEL[r.recommendation] ?? r.recommendation}` : ""}</p>
                {r.comments ? <p className="mt-2 max-w-[70ch] whitespace-pre-line">{r.comments}</p> : <p className="mt-2 text-sm text-muted-foreground">No written comments.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {status === "REVISION_REQUIRED" && (
        <section className="mt-10 border-2 border-primary p-5" aria-labelledby="rev-h">
          <h2 id="rev-h" className="text-[1.5rem]">Submit a revision</h2>
          <p className="mt-2 text-[15px] text-muted-foreground">The earlier version is kept. Your revision becomes a new version and goes back to the editor.</p>
          <div className="mt-4 space-y-3">
            <label className="block text-[15px] font-medium">Revised manuscript (PDF or Word .docx)<input type="file" accept={MANUSCRIPT_ACCEPT} className="mt-1 block w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <label className="block text-[15px] font-medium">Anonymized copy, if double-anonymous review (PDF or .docx)<input type="file" accept={MANUSCRIPT_ACCEPT} className="mt-1 block w-full" onChange={(e) => setAnon(e.target.files?.[0] ?? null)} /></label>
            <label className="block text-[15px] font-medium">What changed<Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
            <label className="block text-[15px] font-medium">Response to the reviewers and editor<Textarea rows={5} value={response} onChange={(e) => setResponse(e.target.value)} /></label>
            <Button onClick={revise} disabled={busy}>{busy ? "Uploading…" : "Submit revision"}</Button>
          </div>
        </section>
      )}
      {["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT"].includes(status) && (
        <details className="mt-10 text-[15px]">
          <summary className="cursor-pointer font-medium">Add or replace the anonymized copy for peer review</summary>
          <div className="mt-3 max-w-xl space-y-2">
            <p className="text-muted-foreground">Remove author names, affiliations and acknowledgements. Reviewers see only this file in double-anonymous review.</p>
            <input type="file" accept={MANUSCRIPT_ACCEPT} disabled={busy} onChange={(e) => addAnon(e.target.files?.[0] ?? null)} />
          </div>
        </details>
      )}
      {canWithdraw && (
        <details className="mt-10 text-[15px]">
          <summary className="cursor-pointer font-medium">Withdraw this submission</summary>
          <div className="mt-3 max-w-xl space-y-3">
            <Textarea rows={2} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="outline" onClick={withdraw} disabled={busy}>Withdraw</Button>
          </div>
        </details>
      )}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { INITIAL: "Submission", REVISION: "Revision", CORRECTION: "Correction" };

function VersionHistory({ paperId, status }: { paperId: string; status: string }) {
  const { data } = useQuery({ queryKey: ["my-versions", paperId, status], queryFn: () => getPaperVersions({ data: { paperId } }) });
  if (!data || data.length < 2) return null; // a single version is the submission itself; history appears once there is something to compare
  return (
    <section className="mt-10" aria-labelledby="versions-h">
      <h2 id="versions-h" className="border-b border-border pb-2 text-[1.5rem]">Version history</h2>
      <p className="mt-3 max-w-[70ch] text-[15px] text-muted-foreground">Every version is kept. Earlier versions are never overwritten, and each file is identified by its SHA-256 hash.</p>
      <ol className="mt-3 divide-y divide-border border-y border-border">
        {[...data].reverse().map((v) => (
          <li key={v.id} className="py-3.5 text-[15px]">
            <p className="font-medium">Version {v.version}{v.is_current ? " (current)" : ""} <span className="font-normal text-muted-foreground">· {KIND_LABEL[v.kind] ?? v.kind} · {fmtDate(v.uploaded_at)}{v.previous_version ? ` · follows ${v.previous_version}` : ""}</span></p>
            {v.change_reason && <p className="mt-1 max-w-[70ch]">{v.change_reason}</p>}
            {v.correction_notice && <p className="mt-1 max-w-[70ch] text-muted-foreground">Public notice: {v.correction_notice}</p>}
            <p className="mt-1 break-all text-sm tabular-nums text-muted-foreground" title={v.file_hash}>SHA-256 {v.file_hash.slice(0, 16)}… · {formatBytes(v.file_size)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
