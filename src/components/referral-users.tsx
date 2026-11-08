import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, Link2, Mail, Search, Users } from "lucide-react";
import { adminListReferralUsers, adminRotateReferralLink, adminSetReferralPartnerActive, adminSetUserReferral } from "@/lib/referrals.functions";
import { MAX_DISCOUNT_MINOR, parseRupees } from "@/lib/domain/referrals";
import type { ReferralUserRow } from "@/lib/server/referrals.server";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/ui";

// ADMINISTRATORS ONLY (REFERRAL_ADMIN, checked on the server). Lists every registered person; the e-mail section is collapsed until opened.
// Choosing a person opens a menu to generate their link and set its discount amount. If the server refuses, nothing is rendered.

const inr = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);
const rupeesText = (minor: number) => (minor % 100 ? (minor / 100).toFixed(2) : String(minor / 100));
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const initials = (n: string | null, email: string) => ((n ?? email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?");
const PRESETS = [50, 100, 200, 500, 1000];

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Copied"); }
  catch { toast.error("Could not copy. Select the text and copy it by hand."); }
}

function Avatar({ name, email, size = "md" }: { name: string | null; email: string; size?: "md" | "lg" }) {
  return <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-primary/10 font-semibold tracking-wide text-primary ring-1 ring-inset ring-primary/15 ${size === "lg" ? "size-12 text-base" : "size-10 text-sm"}`}>{initials(name, email)}</span>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-wash px-4 py-3">
      <div className="text-[1.35rem] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function EmailRow({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group inline-flex items-center gap-1.5 rounded-md py-1 pr-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25">
        <Mail className="size-3.5" aria-hidden />
        {open ? "Hide email address" : "Show email address"}
        <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-border bg-wash py-1.5 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 break-all font-mono text-[13px]">{email}</span>
          <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 px-2.5" onClick={() => void copy(email)} aria-label="Copy email address"><Copy /></Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function LinkMenu({ user, onClose, onChanged }: { user: ReferralUserRow; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const r = user.referral;
  const [amount, setAmount] = useState(r ? rupeesText(r.discountMinor) : "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const minor = parseRupees(amount);
  const invalid = amount.trim() !== "" && minor === null;
  const uploaders = r?.uploaders.length ?? 0;
  const changed = !r || (minor !== null && minor !== r.discountMinor);

  const save = async () => {
    if (minor === null) return;
    setBusy(true);
    try { const res = await adminSetUserReferral({ data: { subjectId: user.id, discountMinor: minor } }); toast.success(res.created ? "Referral link generated" : "Discount saved"); await onChanged(); }
    catch (e) { toast.error(errMsg(e, "Could not save")); } finally { setBusy(false); }
  };
  const rotate = async () => {
    if (!r || !window.confirm("Replace this link? The old link stops counting new referrals. Everything already recorded stays, and the discount carries over.")) return;
    setBusy(true);
    try { await adminRotateReferralLink({ data: { id: r.partnerId } }); toast.success("New link created"); await onChanged(); }
    catch (e) { toast.error(errMsg(e, "Could not create a new link")); } finally { setBusy(false); }
  };
  const toggle = async () => {
    if (!r) return;
    setBusy(true);
    try { await adminSetReferralPartnerActive({ data: { id: r.partnerId, active: !r.partnerActive } }); toast.success(r.partnerActive ? "Paused: the link stops counting new referrals" : "Resumed"); await onChanged(); }
    catch (e) { toast.error(errMsg(e, "Could not update")); } finally { setBusy(false); }
  };

  return (
    <div className="min-w-0 space-y-6">
      <DialogHeader className="space-y-3 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={user.name} email={user.email} size="lg" />
          <div className="min-w-0">
            <DialogTitle className="break-words text-[1.25rem] leading-tight">{user.name ?? "Name not given"}</DialogTitle>
            <DialogDescription className="mt-0.5 break-words text-sm">{r ? "Referral link and discount" : "Generate a referral link for this person"}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <section aria-labelledby="disc-h" className="space-y-3">
        <h3 id="disc-h" className="font-sans text-[15px] font-semibold">Discount amount</h3>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">₹</span>
          <input aria-label="Discount amount in rupees" aria-invalid={invalid || undefined} inputMode="decimal" autoComplete="off" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            className={`h-14 w-full min-w-0 rounded-xl border bg-background pl-10 pr-4 text-2xl font-semibold tabular-nums shadow-soft outline-none transition focus:ring-4 ${invalid ? "border-destructive focus:ring-destructive/20" : "border-input focus:border-primary focus:ring-primary/20"}`} />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setAmount(String(p))} aria-pressed={minor === p * 100}
              className={`h-9 rounded-full border px-3.5 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 ${minor === p * 100 ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:border-primary/40 hover:text-primary"}`}>₹{p.toLocaleString("en-IN")}</button>
          ))}
        </div>
        <p role="status" className={`text-sm ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
          {invalid ? `Enter an amount in rupees, up to two decimals, at most ${inr(MAX_DISCOUNT_MINOR)}.`
            : minor === null ? "Set the amount taken off the submission fee of each person who comes through this link."
            : `${inr(minor)} is taken off the submission fee of each person who opens this link, once per person. It never takes a fee below ₹1.`}
        </p>
        <p className="text-xs text-muted-foreground">The discount is applied when the person pays their fee, and the person, their e-mail and this link are recorded under "Discounts given" below. Authors never see this.</p>
      </section>

      {r && (
        <section aria-labelledby="link-h" className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="link-h" className="font-sans text-[15px] font-semibold">Referral link</h3>
            {!r.partnerActive && <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">Paused</span>}
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-wash py-1.5 pl-3.5 pr-1.5">
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input readOnly aria-label="Referral link" value={r.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-[13px] outline-none" />
            <Button type="button" size="sm" onClick={() => { void copy(r.url); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={rotate}>New link</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={toggle}>{r.partnerActive ? "Pause" : "Resume"}</Button>
          </div>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
            <Stat label="Signed up" value={String(r.signups)} />
            <Stat label="Uploaded" value={String(uploaders)} />
            <Stat label="Off each fee" value={uploaders ? inr(r.perUploaderMinor) : "—"} />
          </div>
          {uploaders > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {r.uploaders.map((u) => (
                <li key={u.userId} className="flex min-w-0 items-baseline justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0"><div className="break-words text-sm font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.papers} article{u.papers === 1 ? "" : "s"}</div></div>
                  <span className="shrink-0 font-semibold tabular-nums">{inr(u.shareMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        <Button type="button" loading={busy} disabled={busy || minor === null || !changed} onClick={save}>{r ? "Save discount" : "Generate referral link"}</Button>
      </div>
    </div>
  );
}

function UserCard({ user, onOpen }: { user: ReferralUserRow; onOpen: () => void }) {
  const r = user.referral;
  return (
    <li className="min-w-0 px-4 py-4 transition-colors sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-3.5 basis-64">
          <Avatar name={user.name} email={user.email} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-words font-semibold">{user.name ?? "Name not given"}</span>
              {!user.name && <span className="rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-caution">Needs name</span>}
            </div>
            <div className="mt-0.5 break-words text-[13px] text-muted-foreground">{user.researcherId}{user.age ? ` · age ${user.age}` : ""} · joined {fmtDate(user.joinedAt)}</div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {r ? <span className={`rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums ${r.partnerActive ? "border-positive/30 bg-positive-soft text-positive" : "border-border text-muted-foreground"}`}>{r.partnerActive ? "Link live" : "Paused"} · {inr(r.discountMinor)}</span>
            : <span className="text-xs text-muted-foreground">No link yet</span>}
          <Button type="button" size="sm" variant={r ? "outline" : "default"} onClick={onOpen}>{r ? "Manage link" : "Generate link"}</Button>
        </div>
      </div>
      <div className="mt-2.5 pl-[3.375rem]"><EmailRow email={user.email} /></div>
    </li>
  );
}

export function ReferralUsers() {
  const qc = useQueryClient();
  const [text, setText] = useState(""); const [q, setQ] = useState(""); const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [text]);
  const list = useQuery({ queryKey: ["referral-users", q, page], queryFn: () => adminListReferralUsers({ data: { ...(q ? { q } : {}), page } }), retry: false, placeholderData: (prev) => prev });
  if (list.isError || !list.data) return list.isLoading ? <p className="text-sm text-muted-foreground">Loading users…</p> : null; // refused: not an administrator
  const d = list.data;
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const open = d.rows.find((u) => u.id === openId) ?? null;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["referral-users"] }), qc.invalidateQueries({ queryKey: ["referral-partners"] })]);

  return (
    <section aria-labelledby="ru-h" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 id="ru-h" className="text-[1.15rem] font-semibold">Registered users</h3>
          <p className="mt-1 max-w-[62ch] text-[15px] text-muted-foreground">Pick a person to generate their referral link and set the discount it carries. Anyone who comes through the link gets this amount off their submission fee.</p>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums"><Users className="size-4" aria-hidden />{d.total} user{d.total === 1 ? "" : "s"}</div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input type="search" aria-label="Search users by name or email" placeholder="Search by name or email" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
          className="h-12 w-full min-w-0 rounded-xl border border-input bg-background pl-11 pr-4 text-base shadow-soft outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/20" />
      </div>

      {d.rows.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-muted-foreground">{q ? "No one matches that search." : "No users yet."}</p> : (
        <ul className={`divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background shadow-soft transition-opacity ${list.isPlaceholderData ? "opacity-60" : ""}`}>
          {d.rows.map((u) => <UserCard key={u.id} user={u} onOpen={() => setOpenId(u.id)} />)}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm tabular-nums text-muted-foreground">Page {page} of {pages}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </nav>
      )}

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto rounded-2xl p-5 shadow-lift sm:p-7">
          {open && <LinkMenu key={`${open.id}:${open.referral?.linkId ?? "new"}:${open.referral?.discountMinor ?? -1}`} user={open} onClose={() => setOpenId(null)} onChanged={refresh} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
