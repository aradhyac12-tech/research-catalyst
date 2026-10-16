import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminListArticles, adminRemoveArticle, adminRestoreArticle, adminListRemovedArticles, adminEraseArticle } from "@/lib/article-removal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, fmtDate } from "@/lib/ui";
import { AuthorCertificatesPanel } from "@/components/author-certificates-admin";

export type DeletablePaper = { id: string; public_id: string; paperly_id: string | null; title: string; status: string; hasPaidFee?: boolean };

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["removed-articles"] }),
    qc.invalidateQueries({ queryKey: ["admin-articles"] }),
    qc.invalidateQueries({ queryKey: ["admin"] }),
  ]);
}

/** True only for administrators (the server refuses everyone else). */
function useIsAdmin() {
  const q = useQuery({ queryKey: ["removed-articles"], queryFn: () => adminListRemovedArticles(), retry: false });
  return { isAdmin: !q.isError && !!q.data, removed: q.data };
}

/** Delete button with an inline confirmation: a reason (kept in the audit log) and the paper reference typed back. */
export function DeleteResearchButton({ paper, onDone }: { paper: DeletablePaper; onDone?: () => void }) {
  const { isAdmin } = useIsAdmin();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [confirm, setConfirm] = useState(""); const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;
  const canConfirm = reason.trim().length >= 10 && [paper.public_id, paper.paperly_id].some((r) => r && r.toUpperCase() === confirm.trim().toUpperCase());
  async function remove() {
    setBusy(true);
    try {
      await adminRemoveArticle({ data: { paperId: paper.id, reason, confirm } });
      toast.success(`${paper.public_id} deleted`); setOpen(false); setReason(""); setConfirm("");
      await refresh(); onDone?.();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete the research"); } finally { setBusy(false); }
  }
  if (!open) return <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>Delete research</Button>;
  return (
    <div className="w-full max-w-xl space-y-3 border border-border bg-background p-4 text-left">
      <p className="font-semibold break-words">Delete {paper.public_id}: {paper.title}</p>
      {paper.hasPaidFee && <p role="note" className="rounded-lg border border-caution bg-caution-soft px-3 py-2 text-sm">The author has paid the fee. Deleting does not refund it. Handle any refund separately.</p>}
      <div><label htmlFor={`del-reason-${paper.id}`} className="mb-1 block text-sm font-medium">Reason (recorded in the audit log)</label><Textarea id={`del-reason-${paper.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} disabled={busy} /></div>
      <div><label htmlFor={`del-confirm-${paper.id}`} className="mb-1 block text-sm font-medium">Type {paper.public_id} to confirm</label><Input id={`del-confirm-${paper.id}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={busy} /></div>
      <div className="flex gap-2">
        <Button type="button" variant="destructive" onClick={remove} disabled={busy || !canConfirm}>{busy ? "Deleting…" : "Delete (hidden, can be restored)"}</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

/** Second step for an already deleted paper: erase it from the database for good. Needs a reason, the typed reference and a tick for the records that go with it. */
function EraseForever({ paper, onDone }: { paper: { id: string; public_id: string; paperly_id: string | null; title: string }; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [confirm, setConfirm] = useState(""); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false);
  const ok = ack && reason.trim().length >= 10 && [paper.public_id, paper.paperly_id].some((r) => r && r.toUpperCase() === confirm.trim().toUpperCase());
  async function erase() {
    setBusy(true);
    try { const r = await adminEraseArticle({ data: { paperId: paper.id, reason, confirm } }); toast.success(`${paper.public_id} erased from the database${r.files.failed ? ` (${r.files.failed} file(s) could not be removed from storage)` : ""}`); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not erase"); } finally { setBusy(false); }
  }
  if (!open) return <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>Erase from database</Button>;
  return (
    <div className="w-full max-w-xl space-y-3 border border-destructive bg-background p-4 text-left">
      <p className="font-semibold break-words">Erase {paper.public_id} permanently</p>
      <p className="text-sm">This removes the paper, all its versions and uploaded files, reviews, decisions, payment records, certificates and declarations from the database. It cannot be undone and it cannot be restored. A summary (including the payment and certificate records) is kept in the audit log. A certificate that was already issued will no longer verify.</p>
      <div><label htmlFor={`er-reason-${paper.id}`} className="mb-1 block text-sm font-medium">Reason (recorded in the audit log)</label><Textarea id={`er-reason-${paper.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} disabled={busy} /></div>
      <div><label htmlFor={`er-confirm-${paper.id}`} className="mb-1 block text-sm font-medium">Type {paper.public_id} to confirm</label><Input id={`er-confirm-${paper.id}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={busy} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} /><span>I understand payment and certificate records for this paper will be erased too.</span></label>
      <div className="flex gap-2"><Button type="button" variant="destructive" onClick={erase} disabled={busy || !ok}>{busy ? "Erasing…" : "Erase permanently"}</Button><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button></div>
    </div>
  );
}

/** Administrators only. Lists every live research record with a Delete button, and the deleted ones with Restore. */
export function RemoveArticles() {
  const { isAdmin, removed } = useIsAdmin();
  const refresh = useRefresh();
  const [search, setSearch] = useState(""); const [term, setTerm] = useState(""); const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["admin-articles", term], queryFn: () => adminListArticles({ data: term ? { query: term } : {} }), retry: false, enabled: isAdmin });
  if (!isAdmin || !removed) return null;

  async function restore(paperId: string) {
    setBusy(true);
    try { await adminRestoreArticle({ data: { paperId } }); toast.success("Research restored"); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not restore"); } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="remove-h" className="space-y-6">
      <div className="space-y-2">
        <h3 id="remove-h" className="text-[1.25rem] font-semibold">Research, authors and certificates</h3>
        <p className="max-w-[70ch] text-[15px] text-muted-foreground">Deleting removes the research from public pages, search, the sitemap, the author's list and every queue, and tells the author. Submitted papers are never erased from the database, so the history, certificates and payment records stay for the audit trail, and a deleted record can be restored below, or erased from the database for good with the second button there. Administrators only.</p>
      </div>
      <form className="flex max-w-xl flex-col gap-2 sm:flex-row" role="search" onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); }}>
        <label htmlFor="del-search" className="sr-only">Search research by title or reference</label>
        <Input id="del-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title or reference, e.g. PLY-2026-000014" autoComplete="off" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      {list.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : list.isError ? <p role="alert" className="text-sm">Could not load the research list.</p> : (list.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No research found.</p> : (
        <ul className="divide-y divide-border border-y border-border">
          {(list.data ?? []).map((p) => (
            <li key={p.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 sm:flex-1">
                <div className="break-words font-medium">{p.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span className="tabular-nums">{p.public_id}</span><StatusBadge status={p.status} /><span>Submitted {fmtDate(p.created_at)}</span></div>
              </div>
              <div className="flex flex-wrap items-start gap-2"><AuthorCertificatesPanel paperId={p.id} publicId={p.public_id} /><DeleteResearchButton paper={p} /></div>
            </li>
          ))}
        </ul>
      )}
      <div>
        <h4 className="font-semibold">Deleted research ({removed.length})</h4>
        {removed.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Nothing has been deleted.</p> : (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {removed.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 sm:flex-1"><div className="break-words font-medium">{r.public_id} {r.title}</div><div className="text-sm text-muted-foreground">Deleted {fmtDate(r.deleted_at)}. {r.deleted_reason}</div></div>
                <div className="flex flex-wrap items-start gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => restore(r.id)}>Restore</Button><EraseForever paper={r} onDone={() => void refresh()} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
