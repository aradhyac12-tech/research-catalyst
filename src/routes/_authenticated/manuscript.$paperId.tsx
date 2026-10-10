import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { getManuscriptView, proposeTrackedChange, withdrawTrackedChange, decideTrackedChange } from "@/lib/manuscript.functions";
import { editorDecide, submitPeerReview } from "@/lib/review.functions";
import { diffWords, type DiffOp } from "@/lib/domain/diff";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageTitle } from "@/lib/ui";
import { RouteError } from "@/components/route-error";

export const Route = createFileRoute("/_authenticated/manuscript/$paperId")({
  validateSearch: z.object({ a: z.string().uuid().optional() }),
  head: () => ({ meta: [{ title: "Manuscript | Paperly" }, { name: "robots", content: "noindex" }] }),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} compact />,
  component: Manuscript,
});

type Field = "title" | "abstract" | "keywords";
const LABEL: Record<Field, string> = { title: "Title", abstract: "Abstract", keywords: "Keywords" };
const input = "flex w-full rounded-[2px] border border-input bg-background px-3 py-2 text-base";

function Marked({ ops, side }: { ops: DiffOp[]; side?: "before" | "after" }) {
  return (
    <p className="whitespace-pre-line leading-relaxed">
      {ops.map((o, i) => {
        if (o.type === "same") return <span key={i}>{o.text}</span>;
        if (o.type === "del") return side === "after" ? null : <del key={i} className="rounded-sm bg-critical-soft px-0.5 text-destructive line-through">{o.text}</del>;
        return side === "before" ? null : <ins key={i} className="rounded-sm bg-positive-soft px-0.5 text-positive underline decoration-1 underline-offset-2">{o.text}</ins>;
      })}
    </p>
  );
}

function Manuscript() {
  const { paperId } = Route.useParams();
  const { a } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["manuscript", paperId, a], queryFn: () => getManuscriptView({ data: { paperId, ...(a ? { assignmentId: a } : {}) } }), retry: false, staleTime: 0 });
  const [editing, setEditing] = useState<Field | null>(null);
  const [text, setText] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["manuscript", paperId] });
  // leave=true: a final decision was recorded, so refresh the queues and return to the list instead of staying on a stale page.
  async function run(fn: () => Promise<unknown>, ok: string, leave = false) {
    setBusy(true);
    try {
      await fn(); toast.success(ok); await refresh();
      if (leave) {
        await Promise.all([qc.invalidateQueries({ queryKey: ["admin"] }), qc.invalidateQueries({ queryKey: ["admin-paper"] }), qc.invalidateQueries({ queryKey: ["reviews"] })]);
        await navigate({ to: d?.role === "editor" ? "/admin" : "/reviews" });
      }
    }
    catch (e) { toast.error(e instanceof Error ? e.message : "That did not work"); } finally { setBusy(false); }
  }
  const d = q.data;
  const edits = useMemo(() => new Map((d?.edits ?? []).map((e) => [e.field as Field, e])), [d]);
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-5 pt-10 text-muted-foreground">Loading…</div>;
  if (q.isError || !d) return <div role="alert" className="mx-auto max-w-4xl px-5 pt-10">{q.error instanceof Error && /not found/i.test(q.error.message) ? "This manuscript is not available to your account." : q.error instanceof Error ? q.error.message : "Could not open the manuscript."}</div>;
  const back = d.role === "editor" ? "/admin" : d.role === "reviewer" ? "/reviews" : "/my-research";
  const changed = d.edits.length;

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16 pt-10">
      <p className="text-sm"><Link to={back} className="link">← Back</Link></p>
      <PageTitle title="Manuscript with tracked changes" subtitle={d.role === "editor" ? "Propose edits to the text. The author's original is never overwritten; each change shows what it was and what it becomes." : d.role === "reviewer" ? "Read the manuscript and the editor's tracked changes, then approve or disapprove." : "The editor's proposed changes to your manuscript."} />

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-wash px-4 py-3 text-sm">
        <span className="font-medium">{changed} tracked change{changed === 1 ? "" : "s"}</span>
        <span><del className="rounded-sm bg-critical-soft px-1 text-destructive line-through">removed text</del></span>
        <span><ins className="rounded-sm bg-positive-soft px-1 text-positive underline">added text</ins></span>
        {d.url && <a className="link ml-auto font-medium" href={d.url} target="_blank" rel="noopener noreferrer">Open the uploaded file (link expires in 5 minutes)</a>}
      </div>

      {(["title", "abstract", "keywords"] as Field[]).map((f) => {
        const e = edits.get(f);
        const current = f === "keywords" ? d.paper.keywords : d.paper[f] ?? "";
        const ops = e ? diffWords(e.before_text, e.after_text) : null;
        return (
          <section key={f} className="mt-8" aria-label={LABEL[f]}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
              <h2 className="text-[1.25rem]">{LABEL[f]}</h2>
              {d.canEdit && editing !== f && (
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(f); setText(e ? e.after_text : current); setNote(e?.note ?? ""); }}>{e ? "Revise change" : "Edit"}</Button>
                  {e && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => withdrawTrackedChange({ data: { editId: e.id } }), "Change withdrawn")}>Withdraw change</Button>}
                </span>
              )}
            </div>
            {ops && e ? (
              <>
                <div className={`mt-3 ${f === "title" ? "font-serif text-[1.375rem] font-semibold" : "text-[15px]"}`}><Marked ops={ops} /></div>
                {e.note && <p className="mt-2 text-sm text-muted-foreground">Editor's note: {e.note}</p>}
                {d.canDecide && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="positive" disabled={busy} onClick={() => run(() => decideTrackedChange({ data: { editId: e.id, accept: true } }), `${LABEL[f]} change accepted`)}>✓ Accept change</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => decideTrackedChange({ data: { editId: e.id, accept: false } }), `${LABEL[f]} change rejected`)}>✕ Reject change</Button>
                  </div>
                )}
                <details className="mt-3 text-[15px]">
                  <summary className="cursor-pointer text-sm font-medium">Show before and after side by side</summary>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-border p-3"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before</p><Marked ops={ops} side="before" /></div>
                    <div className="rounded-xl border border-border p-3"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">After</p><Marked ops={ops} side="after" /></div>
                  </div>
                </details>
              </>
            ) : (
              <p className={`mt-3 whitespace-pre-line leading-relaxed ${f === "title" ? "font-serif text-[1.375rem] font-semibold" : "text-[15px]"}`}>{current || <span className="text-muted-foreground">Not provided.</span>}</p>
            )}
            {editing === f && (
              <div className="mt-3 space-y-3 rounded-xl border border-border bg-background p-4">
                {f === "title" || f === "keywords" ? <input className={input} value={text} onChange={(x) => setText(x.target.value)} /> : <Textarea rows={10} value={text} onChange={(x) => setText(x.target.value)} />}
                <input className={input} placeholder="Why this change? (optional, visible to the author and reviewers)" value={note} onChange={(x) => setNote(x.target.value)} maxLength={1000} />
                <div className="flex gap-2">
                  <Button disabled={busy || !text.trim()} onClick={() => run(async () => { await proposeTrackedChange({ data: { paperId, field: f, after: text, ...(note.trim() ? { note } : {}) } }); setEditing(null); }, "Tracked change saved")}>Save as tracked change</Button>
                  <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {d.role === "editor" && <EditorDecision paperId={paperId} status={d.paperStatus} ready={d.decisionReady} busy={busy} run={run} />}
      {d.role === "reviewer" && d.assignment && <ReviewerDecision assignment={d.assignment} paperStatus={d.paperStatus} busy={busy} run={run} />}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok: string, leave?: boolean) => Promise<void>;

function EditorDecision({ paperId, status, ready, busy, run }: { paperId: string; status: string; ready: boolean; busy: boolean; run: Run }) {
  const [reason, setReason] = useState("");
  const ok = ready;
  return (
    <section className="mt-12 space-y-3 rounded-2xl border border-border bg-wash p-5" aria-label="Editorial decision">
      <h2 className="text-[1.25rem]">Your decision</h2>
      <p className="text-sm text-muted-foreground">Current status: {status.replace(/_/g, " ").toLowerCase()}. The same rules as the editorial queue apply: a journal article needs completed peer reviews before it can be approved.</p>
      {!ready && <p role="status" className="rounded-xl border border-border bg-background px-3 py-2 text-sm">A decision can be recorded once the paper reaches editorial screening or the decision stage. It is now: {status.replace(/_/g, " ").toLowerCase()}.{status === "PEER_REVIEW" ? " Close the reviews from the editorial queue (at least one completed review is needed) to move it to a decision." : ""}</p>}
      <Textarea rows={3} placeholder="What changes are needed, or why you disapprove (optional — the author will see it)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="positive" size="lg" className="rounded-full" disabled={busy || !ok} onClick={() => run(() => editorDecide({ data: { paperId, outcome: "ACCEPT", ...(reason.trim() ? { reason } : {}) } }), "Approved", true)}>✓ Approve</Button>
        <Button variant="destructive" size="lg" className="rounded-full" disabled={busy || !ok} onClick={() => run(() => editorDecide({ data: { paperId, outcome: "REJECT", ...(reason.trim() ? { reason } : {}) } }), "Disapproved", true)}>✕ Disapprove</Button>
      </div>
    </section>
  );
}

function ReviewerDecision({ assignment, paperStatus, busy, run }: { assignment: { id: string; status: string }; paperStatus: string; busy: boolean; run: Run }) {
  const [comments, setComments] = useState(""); const [conf, setConf] = useState("");
  if (assignment.status === "COMPLETED") return <p className="mt-12 rounded-xl border border-border bg-wash p-4 text-[15px]">You have already submitted your review of this manuscript.</p>;
  const ok = paperStatus === "PEER_REVIEW";
  const send = (recommendation: "ACCEPT" | "REJECT") => run(() => submitPeerReview({ data: { id: assignment.id, recommendation, ...(comments.trim() ? { comments_to_author: comments } : {}), ...(conf.trim() ? { confidential_to_editor: conf } : {}) } }), recommendation === "ACCEPT" ? "Approval submitted" : "Disapproval submitted", true);
  return (
    <section className="mt-12 space-y-3 rounded-2xl border border-border bg-wash p-5" aria-label="Your review">
      <h2 className="text-[1.25rem]">Your review</h2>
      {paperStatus !== "PEER_REVIEW" && <p role="status" className="text-sm text-muted-foreground">This manuscript is not open for review right now.</p>}
      <label className="block text-[15px] font-medium">What changes are needed, or why you disapprove (optional — the author will see it)<Textarea rows={6} className="mt-1" value={comments} onChange={(e) => setComments(e.target.value)} /></label>
      <label className="block text-[15px] font-medium">Confidential comments to the editor (optional)<Textarea rows={2} className="mt-1" value={conf} onChange={(e) => setConf(e.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="positive" size="lg" className="rounded-full" disabled={busy || !ok} onClick={() => send("ACCEPT")}>✓ Approve</Button>
        <Button variant="destructive" size="lg" className="rounded-full" disabled={busy || !ok} onClick={() => send("REJECT")}>✕ Disapprove</Button>
        <span className="text-xs text-muted-foreground">A submitted review cannot be edited. To ask for revisions instead, use <Link to="/reviews" className="link">My reviews</Link>.</span>
      </div>
    </section>
  );
}
