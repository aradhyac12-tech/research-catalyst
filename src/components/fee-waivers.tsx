import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listFeeWaivers, addFeeWaiver, removeFeeWaiver } from "@/lib/fee-waiver.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/ui";

/** Administrators and founders. Pause the paywall for one person (by email) so they can submit and publish without the fee. An administrator's pause outranks a founder's. Renders nothing for anyone else. */
export function FeeWaivers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fee-waivers"], queryFn: () => listFeeWaivers(), retry: false });
  const [email, setEmail] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  if (q.isError || !q.data) return null; // not an administrator or founder (the server refuses), or still loading
  async function add() {
    setBusy(true);
    try { const r = await addFeeWaiver({ data: { email, ...(note.trim() ? { note } : {}) } }); toast.success(`Paywall paused for ${r.email}`); setEmail(""); setNote(""); await qc.invalidateQueries({ queryKey: ["fee-waivers"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not pause the paywall"); } finally { setBusy(false); }
  }
  async function remove(userId: string) {
    setBusy(true);
    try { await removeFeeWaiver({ data: { userId } }); toast.success("Paywall resumed"); await qc.invalidateQueries({ queryKey: ["fee-waivers"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not resume the paywall"); } finally { setBusy(false); }
  }
  return (
    <section aria-labelledby="waiver-h" className="mt-10 space-y-4 border-t border-border pt-6">
      <h3 id="waiver-h" className="text-[1.25rem] font-semibold">Pause the paywall for someone</h3>
      <p className="max-w-[70ch] text-[15px] text-muted-foreground">Enter the email of a registered account. While paused, their papers are screened without a fee and publish without a fee. Resume it at any time. Administrators and founders can use this; a pause set by an administrator can only be changed by an administrator.</p>
      <div className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1"><label htmlFor="waiver-email" className="mb-1 block text-sm font-medium">Email</label><Input id="waiver-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" autoComplete="off" disabled={busy} /></div>
        <div className="flex-1"><label htmlFor="waiver-note" className="mb-1 block text-sm font-medium">Note (optional)</label><Input id="waiver-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why" disabled={busy} /></div>
        <Button type="button" onClick={add} disabled={busy || !email.trim()}>Pause paywall</Button>
      </div>
      {q.data.length === 0 ? <p className="text-sm text-muted-foreground">No one has the paywall paused.</p> : (
        <ul className="divide-y divide-border border-y border-border">
          {q.data.map((w) => (
            <li key={w.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><div className="break-all font-medium">{w.email}</div><div className="text-sm text-muted-foreground">Paused by {w.setBy.toLowerCase()} {fmtDate(w.since)}{w.note ? ` · ${w.note}` : ""}</div></div>
              <Button type="button" size="sm" variant="outline" disabled={busy || !w.canChange} title={w.canChange ? undefined : "Set by an administrator"} onClick={() => remove(w.userId)}>{w.canChange ? "Resume paywall" : "Admin only"}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
