import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { myReviewInvitations, respondToReviewInvitation, reviewerManuscript, submitPeerReview } from "@/lib/review.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageTitle, fmtDate } from "@/lib/ui";
import { REVIEW_MODEL_LABEL, type ReviewModel } from "@/lib/domain/review";

export const Route = createFileRoute("/_authenticated/reviews")({
  head: () => ({ meta: [{ title: "My reviews | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "My reviews | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Reviews,
});

const select = "flex h-11 w-full rounded-[2px] border border-input bg-background px-3 text-base";
const REC: Array<[string, string]> = [["ACCEPT", "Approve"], ["MINOR_REVISION", "Minor revision"], ["MAJOR_REVISION", "Major revision"], ["REJECT", "Disapprove"]];

function Reviews() {
  const { data, isLoading } = useQuery({ queryKey: ["my-invitations"], queryFn: () => myReviewInvitations() });
  const [open, setOpen] = useState<string | null>(null);
  const invited = (data ?? []).filter((r) => r.status === "INVITED");
  const active = (data ?? []).filter((r) => r.status === "ACCEPTED");
  const done = (data ?? []).filter((r) => !["INVITED", "ACCEPTED"].includes(r.status));
  return (
    <div className="mx-auto max-w-4xl px-5 pt-10">
      <PageTitle title="My reviews" subtitle="Invitations and active reviews. In double-anonymous review you will not see who wrote the manuscript." />
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && <p className="border-y border-border py-8 text-muted-foreground">You have no review invitations.</p>}
      <Group title="Invitations" rows={invited} open={open} setOpen={setOpen} />
      <Group title="Active reviews" rows={active} open={open} setOpen={setOpen} />
      <Group title="Completed and closed" rows={done} open={open} setOpen={setOpen} />
    </div>
  );
}

type Row = NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof myReviewInvitations>>>>["data"]>[number];
function Group({ title, rows, open, setOpen }: { title: string; rows: Row[]; open: string | null; setOpen: (id: string | null) => void }) {
  if (!rows.length) return null;
  return (
    <section className="mt-10">
      <h2 className="border-b border-border pb-2 text-[1.5rem]">{title}</h2>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <button className="flex w-full items-center justify-between gap-4 py-4 text-left hover:bg-wash" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <div className="min-w-0"><div className="text-sm text-muted-foreground">{r.article_type}, round {r.round}{r.due_at ? `, due ${fmtDate(r.due_at)}` : ""}</div><div className="font-serif text-[1.125rem] font-semibold text-primary">{r.title}</div></div>
              <span className="text-sm font-medium">{r.status.toLowerCase()}</span>
            </button>
            {open === r.id && <Detail row={r} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({ row }: { row: Row }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [coi, setCoi] = useState<"NONE" | "POTENTIAL" | "CONFLICT">("NONE");
  const [coiText, setCoiText] = useState("");
  const [rec, setRec] = useState("MINOR_REVISION"); const [comments, setComments] = useState(""); const [conf, setConf] = useState("");
  const ms = useQuery({ queryKey: ["review-ms", row.id], queryFn: () => reviewerManuscript({ data: { id: row.id } }), enabled: row.status === "ACCEPTED" || row.status === "COMPLETED", retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["my-invitations"] }); };
  async function respond(accept: boolean) {
    setBusy(true);
    try { await respondToReviewInvitation({ data: { id: row.id, accept, coi: accept ? coi : "NONE", ...(coiText.trim() ? { coiStatement: coiText } : {}) } }); toast.success(accept && coi !== "CONFLICT" ? "Invitation accepted" : "Invitation declined"); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not record your response"); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true);
    try { await submitPeerReview({ data: { id: row.id, recommendation: rec as "ACCEPT", ...(comments.trim() ? { comments_to_author: comments } : {}), ...(conf.trim() ? { confidential_to_editor: conf } : {}) } }); toast.success("Review submitted"); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit the review"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-5 border-t border-border bg-wash px-5 py-6">
      {row.abstract && <div><h3 className="text-[1.0625rem]">Abstract</h3><p className="mt-1 text-[15px] leading-relaxed">{row.abstract}</p></div>}
      {row.status === "INVITED" && (
        <div className="space-y-3">
          <fieldset className="space-y-2"><legend className="font-semibold">Conflict of interest</legend>
            {([["NONE", "I have no conflict of interest with this work."], ["POTENTIAL", "I have a potential conflict, described below."], ["CONFLICT", "I have a conflict and must decline."]] as const).map(([v, l]) => (
              <label key={v} className="flex items-start gap-2 text-[15px]"><input type="radio" name={`coi-${row.id}`} checked={coi === v} onChange={() => setCoi(v)} className="mt-1" />{l}</label>
            ))}
          </fieldset>
          {coi === "POTENTIAL" && <Textarea rows={2} placeholder="Describe the potential conflict" value={coiText} onChange={(e) => setCoiText(e.target.value)} />}
          <div className="flex gap-2"><Button size="lg" className="rounded-full" disabled={busy || coi === "CONFLICT"} onClick={() => respond(true)}>{busy ? "Working…" : "Accept invitation"}</Button><Button size="lg" className="rounded-full" variant="outline" disabled={busy} onClick={() => respond(false)}>Decline</Button></div>
        </div>
      )}
      {(row.status === "ACCEPTED" || row.status === "COMPLETED") && ms.data && (
        <div className="space-y-4">
          <p className="text-[15px]">Review model: {REVIEW_MODEL_LABEL[ms.data.review_model as ReviewModel]}.</p>
          {ms.data.authors && <p className="text-[15px]"><span className="font-semibold">Authors: </span>{ms.data.authors.map((a) => a.full_name).join(", ")}</p>}
          <p><Link to="/manuscript/$paperId" params={{ paperId: row.paper_id }} search={{ a: row.id }} className="link font-medium">Read the manuscript online, with the editor's tracked changes</Link></p>
          {ms.data.url ? <a className="link font-medium" href={ms.data.url} target="_blank" rel="noopener noreferrer">Open the manuscript (link expires in 5 minutes)</a> : <p>The manuscript file is not available.</p>}
        </div>
      )}
      {row.status === "ACCEPTED" && (
        <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
          <p className="text-[15px] font-medium">Recommendation</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {REC.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setRec(v)} className={`rounded-full border px-3 py-2.5 text-sm font-semibold transition-colors ${rec === v ? (v === "ACCEPT" ? "border-positive bg-positive-soft text-positive" : v === "REJECT" ? "border-destructive bg-critical-soft text-destructive" : "border-primary bg-wash text-primary") : "border-border text-muted-foreground hover:border-foreground/40"}`}>{l}</button>
            ))}
          </div>
          <label className="block text-[15px] font-medium">What changes are needed, or why you disapprove (optional — the author will see it)<Textarea rows={8} className="rounded-xl" value={comments} onChange={(e) => setComments(e.target.value)} /></label>
          <label className="block text-[15px] font-medium">Confidential comments to the editor (optional; authors never see these)<Textarea rows={3} className="rounded-xl" value={conf} onChange={(e) => setConf(e.target.value)} /></label>
          <Button size="lg" className="w-full rounded-full sm:w-auto" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit review"}</Button>
          <p className="text-xs text-muted-foreground">A submitted review cannot be edited.</p>
        </div>
      )}
      {row.status === "COMPLETED" && <p className="text-[15px]">You submitted this review on {fmtDate(row.completed_at)}. Recommendation: {String(row.recommendation).replace(/_/g, " ").toLowerCase()}.</p>}
    </div>
  );
}
