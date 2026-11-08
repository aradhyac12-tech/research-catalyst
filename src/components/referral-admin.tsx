import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  adminClearPaperReferral, adminCreateReferralPartner, adminGetPaperReferral, adminListReferralDiscounts, adminListReferralPartners, adminReferralRecent,
  adminRotateReferralLink, adminSetPaperReferralShares, adminSetReferralPartnerActive, adminUpdateReferralPartner,
} from "@/lib/referrals.functions";
import { validateShares } from "@/lib/domain/referrals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, money } from "@/lib/ui";
import { ReferralUsers } from "@/components/referral-users";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { displayTitle } from "@/lib/title-case";

// ADMINISTRATORS ONLY. Everything in this file is fetched through server functions that check the REFERRAL_ADMIN permission on the server.
// If the server refuses (not an administrator), these components render nothing: the screen never receives partner identities.

const field = "flex h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base";
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const SOURCE_LABEL: Record<string, string> = {
  SUBMISSION_LINK: "Link used for this submission",
  REGISTRATION: "Author registered through this partner",
  JOINT_AUTO: "Shared automatically (two different links)",
  ADMIN: "Set by an administrator",
};
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Link copied"); }
  catch { toast.error("Could not copy. Select the link and copy it by hand."); }
}

/** Publisher view: every acquisition partner with their private link, totals, and the latest attributed articles. */
export function ReferralAdmin() {
  const qc = useQueryClient();
  const partners = useQuery({ queryKey: ["referral-partners"], queryFn: () => adminListReferralPartners(), retry: false });
  const recent = useQuery({ queryKey: ["referral-recent"], queryFn: () => adminReferralRecent(), retry: false, enabled: !!partners.data });
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ displayName: "", contactEmail: "", notes: "" });
  if (partners.isError || !partners.data) return partners.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["referral-partners"] }), qc.invalidateQueries({ queryKey: ["referral-recent"] })]);
  const run = async (fn: () => Promise<unknown>, ok: string, fallback: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await refresh(); return true; } catch (e) { toast.error(errMsg(e, fallback)); return false; } finally { setBusy(false); }
  };
  const create = async () => {
    const done = await run(() => adminCreateReferralPartner({ data: { displayName: name, ...(email.trim() ? { contactEmail: email } : {}), ...(notes.trim() ? { notes } : {}) } }), "Partner added with a new link", "Could not add the partner");
    if (done) { setName(""); setEmail(""); setNotes(""); }
  };
  const startEdit = (p: { id: string; displayName: string; contactEmail: string | null; notes: string | null }) => { setEditing(p.id); setDraft({ displayName: p.displayName, contactEmail: p.contactEmail ?? "", notes: p.notes ?? "" }); };
  const saveEdit = async (id: string) => {
    const done = await run(() => adminUpdateReferralPartner({ data: { id, displayName: draft.displayName, ...(draft.contactEmail.trim() ? { contactEmail: draft.contactEmail } : {}), ...(draft.notes.trim() ? { notes: draft.notes } : {}) } }), "Saved", "Could not save");
    if (done) setEditing(null);
  };

  return (
    <div className="min-w-0 space-y-8">
      <div>
        <h2 className="border-b border-border pb-2 text-[1.5rem]">Referrals</h2>
        <p className="mt-3 max-w-[70ch] text-[15px]">Links are random codes: they never contain a name, initials or username. Only administrators can see who a link belongs to. Authors never see any of this.</p>
      </div>

      <ReferralUsers />

      <DiscountsGiven />

      <Collapsible className="min-w-0 space-y-6 border-t border-border pt-6">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left text-[1.15rem] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25">
          <span>Other referral partners (not registered users)</span>
          <span aria-hidden className="text-sm text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180">▾</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="min-w-0 space-y-8">

      <section aria-labelledby="ref-add-h" className="space-y-3">
        <h3 id="ref-add-h" className="text-[1.15rem] font-semibold">Add a partner</h3>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Name (private)<Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={busy} autoComplete="off" /></label>
          <label className="block text-sm font-medium">Contact email (optional)<Input type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} disabled={busy} autoComplete="off" /></label>
          <label className="block text-sm font-medium sm:col-span-2">Notes (optional)<Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} disabled={busy} /></label>
        </div>
        <Button type="button" disabled={busy || name.trim().length < 2} onClick={create}>Add partner and create link</Button>
      </section>

      <section aria-labelledby="ref-list-h" className="space-y-3">
        <h3 id="ref-list-h" className="text-[1.15rem] font-semibold">Partners and links</h3>
        {partners.data.length === 0 ? <p className="text-sm text-muted-foreground">No partners yet.</p> : (
          <ul className="divide-y divide-border border-y border-border">
            {partners.data.map((p) => (
              <li key={p.id} className="min-w-0 space-y-3 py-4">
                {editing === p.id ? (
                  <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium">Name<input className={field} value={draft.displayName} maxLength={120} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} /></label>
                    <label className="block text-sm font-medium">Contact email<input className={field} type="email" value={draft.contactEmail} maxLength={254} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} /></label>
                    <label className="block text-sm font-medium sm:col-span-2">Notes<Textarea rows={2} value={draft.notes} maxLength={1000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
                    <div className="flex gap-2 sm:col-span-2"><Button type="button" size="sm" disabled={busy || draft.displayName.trim().length < 2} onClick={() => saveEdit(p.id)}>Save</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-lg font-semibold">{p.displayName} {!p.active && <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal uppercase tracking-wide text-muted-foreground">Paused</span>}</div>
                      {(p.contactEmail || p.notes) && <div className="break-words text-sm text-muted-foreground">{[p.contactEmail, p.notes].filter(Boolean).join(" · ")}</div>}
                      <div className="mt-1 text-sm text-muted-foreground">{p.registrations} registered · {p.articles} article{p.articles === 1 ? "" : "s"} · {Number(p.credited.toFixed(2))} credited · added {fmtDate(p.createdAt)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => startEdit(p)}>Edit</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => adminSetReferralPartnerActive({ data: { id: p.id, active: !p.active } }), p.active ? "Paused: the link stops counting new referrals" : "Resumed", "Could not update")}>{p.active ? "Pause" : "Resume"}</Button>
                    </div>
                  </div>
                )}
                {p.link ? (
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                    <input readOnly aria-label="Referral link" className={`${field} font-mono text-sm`} value={p.link.url} onFocus={(e) => e.currentTarget.select()} />
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" onClick={() => copy(p.link!.url)}>Copy link</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("Replace this link? The old link stops counting new referrals. Everything already recorded stays.")) void run(() => adminRotateReferralLink({ data: { id: p.id } }), "New link created", "Could not create a new link"); }}>New link</Button>
                    </div>
                  </div>
                ) : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => adminRotateReferralLink({ data: { id: p.id } }), "New link created", "Could not create a link")}>Create link</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ref-recent-h" className="space-y-3">
        <h3 id="ref-recent-h" className="text-[1.15rem] font-semibold">Latest articles with a referral source</h3>
        {!recent.data?.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <ul className="divide-y divide-border border-y border-border">
            {recent.data.map((r) => (
              <li key={r.paperId} className="min-w-0 py-3">
                <div className="break-words font-medium">{r.title ? displayTitle(r.title) : r.publicId}</div>
                <div className="break-words text-sm text-muted-foreground">{r.paperlyId ?? r.publicId} · {r.shares.map((s) => `${s.partnerName} ${pct(s.sharePercent)}`).join(" · ")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

type Row = { partnerId: string; percent: string };

/** Admin article view: where this article came from, with each partner's share. Administrators can correct or split it. */
/** Everyone who had a link discount taken off their submission fee: person, e-mail, whose link, paper and amounts. Administrators only. */
function DiscountsGiven() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["referral-discounts", page], queryFn: () => adminListReferralDiscounts({ data: { page } }), retry: false });
  if (q.isError || !q.data) return q.isLoading ? <p className="text-sm text-muted-foreground">Loading discounts…</p> : null;
  const d = q.data; const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  return (
    <section aria-labelledby="ref-disc-h" className="min-w-0 space-y-3 border-t border-border pt-6">
      <h3 id="ref-disc-h" className="text-[1.15rem] font-semibold">Discounts given on submission fees</h3>
      <p className="max-w-[70ch] text-[15px] text-muted-foreground">A person who came through a link has its discount taken off their fee, once. Total given on fees that were paid: <span className="font-semibold tabular-nums text-foreground">{money(d.totalGivenMinor, "INR")}</span>. Authors never see this list or whose link it was.</p>
      {d.rows.length === 0 ? <p className="text-[15px] text-muted-foreground">No discounts have been used yet.</p> : (
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">Link discounts given</caption>
          <thead><tr className="border-b border-border text-muted-foreground"><th className="w-[30%] py-1 pr-2">Person</th><th className="w-[20%] pr-2">Link of</th><th className="w-[20%] pr-2">Paper</th><th className="w-[12%] pr-2">Discount</th><th className="w-[18%]">Fee paid</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.paymentId} className="border-b border-border align-top">
              <td className="py-2 pr-2 [overflow-wrap:anywhere]"><span className="block font-medium">{r.name}</span><span className="block text-muted-foreground">{r.email}</span></td>
              <td className="pr-2 [overflow-wrap:anywhere]">{r.partnerName}</td>
              <td className="pr-2 [overflow-wrap:anywhere]">{r.paperPublicId ?? "—"}<span className="block text-muted-foreground">{fmtDate(r.createdAt)}</span></td>
              <td className="pr-2 tabular-nums">−{money(r.discountMinor, r.currency)}</td>
              <td className="tabular-nums">{money(r.paidMinor, r.currency)}{r.originalMinor !== null && <span className="block text-muted-foreground">of {money(r.originalMinor, r.currency)}</span>}<span className="block text-xs uppercase tracking-wide text-muted-foreground">{r.status}</span></td>
            </tr>))}</tbody>
        </table>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="tabular-nums text-muted-foreground">Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </section>
  );
}

export function PaperReferralPanel({ paperId }: { paperId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-paper-referral", paperId], queryFn: () => adminGetPaperReferral({ data: { paperId } }), retry: false });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isError || !q.data) return q.isLoading ? <p className="text-xs text-muted-foreground">Loading referral source…</p> : null; // the server refused: not an administrator
  const d = q.data;
  const refresh = async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["admin-paper-referral", paperId] }), qc.invalidateQueries({ queryKey: ["referral-partners"] }), qc.invalidateQueries({ queryKey: ["referral-recent"] })]); };
  const parsed = (rows ?? []).map((r) => ({ partnerId: r.partnerId, sharePercent: Number(r.percent) }));
  const check = rows ? (rows.some((r) => !r.partnerId || r.percent.trim() === "") ? { ok: false as const, reason: "Choose a partner and a percentage for every row" } : validateShares(parsed)) : null;
  const total = parsed.reduce((a, r) => a + (Number.isFinite(r.sharePercent) ? r.sharePercent : 0), 0);
  const startEdit = () => setRows(d.shares.length ? d.shares.map((s) => ({ partnerId: s.partnerId, percent: String(s.sharePercent) })) : [{ partnerId: "", percent: "100" }]);
  const equal = () => {
    if (!rows?.length) return;
    const n = rows.length, base = Math.floor(10000 / n), extra = 10000 - base * n; // whole hundredths, the remainder goes to the first rows
    setRows(rows.map((r, i) => ({ ...r, percent: String((base + (i < extra ? 1 : 0)) / 100) })));
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setRows(null); await refresh(); } catch (e) { toast.error(errMsg(e, "Could not save")); } finally { setBusy(false); }
  };

  return (
    <section aria-label="Referral source" className="min-w-0 space-y-3 rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">Referral source</h4>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Administrators only · never shown to authors</span>
      </div>
      {!rows ? (
        <>
          {d.shares.length === 0 ? <p className="text-sm text-muted-foreground">No referral source recorded for this article.</p> : (
            <ul className="divide-y divide-border border-y border-border">
              {d.shares.map((s) => (
                <li key={s.partnerId} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                  <div className="min-w-0"><span className="break-words font-medium">{s.partnerName}</span><div className="text-xs text-muted-foreground">{SOURCE_LABEL[s.source] ?? s.source} · {fmtDate(s.recordedAt)}</div></div>
                  <span className="text-lg font-semibold tabular-nums">{pct(s.sharePercent)}</span>
                </li>
              ))}
            </ul>
          )}
          {d.shares.length > 1 && <p className="text-xs text-muted-foreground">Joint attribution: the shares add up to 100%.</p>}
          {d.registeredVia && !d.shares.some((s) => s.partnerId === d.registeredVia!.partnerId) && <p className="break-words text-sm text-muted-foreground">The author registered through {d.registeredVia.partnerName}, who has no share of this article.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={startEdit}>{d.shares.length ? "Edit shares" : "Add a source"}</Button>
            {d.shares.length > 0 && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("Remove the referral source from this article?")) void act(() => adminClearPaperReferral({ data: { paperId } }), "Referral source removed"); }}>Remove</Button>}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-2">
                <select aria-label="Partner" className={field} value={r.partnerId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, partnerId: e.target.value } : x)))}>
                  <option value="">Choose a partner…</option>
                  {d.partners.map((p) => <option key={p.id} value={p.id} disabled={rows.some((x, j) => j !== i && x.partnerId === p.id)}>{p.name}{p.active ? "" : " (paused)"}</option>)}
                </select>
                <div className="relative"><input aria-label="Share in percent" inputMode="decimal" className={`${field} pr-7`} value={r.percent} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span></div>
                <Button type="button" size="sm" variant="outline" aria-label="Remove this partner" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={rows.length >= Math.min(10, d.partners.length)} onClick={() => setRows([...rows, { partnerId: "", percent: "" }])}>Add partner</Button>
            <Button type="button" size="sm" variant="outline" onClick={equal}>Split equally</Button>
            <span role="status" className={`text-sm tabular-nums ${check && !check.ok ? "text-destructive" : "text-muted-foreground"}`}>Total {Number(total.toFixed(2))}%{check && !check.ok ? ` · ${check.reason}` : ""}</span>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !check?.ok} onClick={() => act(() => adminSetPaperReferralShares({ data: { paperId, shares: parsed } }), "Referral source saved")}>Save</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setRows(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** For lists of articles: a collapsed "Referral source" row that opens the panel in place. Renders nothing when the server says the viewer is not an administrator. */
export function ReferralToggle({ paperId }: { paperId: string }) {
  const [open, setOpen] = useState(false);
  const gate = useQuery({ queryKey: ["referral-gate"], queryFn: () => adminListReferralPartners(), retry: false, staleTime: 60_000 });
  if (gate.isError || !gate.data) return null;
  return (
    <div className="min-w-0 space-y-2">
      <Button type="button" size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide referral source" : "Referral source"}</Button>
      {open && <PaperReferralPanel paperId={paperId} />}
    </div>
  );
}
