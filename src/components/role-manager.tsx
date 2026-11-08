import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listUsersForRoles, adminSetFounderDues, listFounderDuesHolds, adminResolveDeferral } from "@/lib/founder.functions";
import { adminSetRole } from "@/lib/review.functions";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/ui";
import { meQuery } from "@/lib/queries";
import { adminSetUserBlock } from "@/lib/maintenance.functions";
import { announceSiteChange } from "@/lib/site-status";

const ROLE_LABEL: Record<string, string> = { editor: "Editor", reviewer: "Reviewer", founder: "Founder", admin: "Admin", super_admin: "Super admin" };
const input = "flex h-11 w-full max-w-sm rounded-lg border border-input bg-background px-3 text-base";

/** Registered users with their roles. Click a person to allow or remove a role. What each caller may do is decided on the server:
 *  administrators can allow editor, reviewer and founder; a founder can allow only editor and reviewer, and not for themselves. */
export function RoleManager() {
  const me = useQuery({ ...meQuery(), staleTime: 10_000 });
  const isAdmin = (me.data?.roles ?? []).some((x) => x === "admin" || x === "super_admin");
  return isAdmin ? <RoleManagerPanel /> : null;
}

type UserList = Awaited<ReturnType<typeof listUsersForRoles>>;

function RoleManagerPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState(""); const [applied, setApplied] = useState(""); const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null); const [pending, setPending] = useState<string | null>(null);
  const key = ["role-users", applied, page] as const;
  // A short cache makes coming back to this list instant; the list refreshes quietly in the background. Names saved by people
  // (sign-up, the details pop-up, Profile) invalidate this key, so a new name appears here without waiting.
  const users = useQuery({ queryKey: key, queryFn: () => listUsersForRoles({ data: { ...(applied ? { q: applied } : {}), page } }), retry: false, staleTime: 15_000, placeholderData: keepPreviousData });
  const d = users.data;
  // All founders with dues, from every page, so a hold is visible without hunting for the person in a long list.
  const dues = useQuery({ queryKey: ["dues-holds"], queryFn: () => listFounderDuesHolds(), retry: false, staleTime: 15_000 });
  const refreshDues = async () => { await qc.invalidateQueries({ queryKey: ["role-users"] }); await qc.invalidateQueries({ queryKey: ["dues-holds"] }); };
  const resolveDue = async (key: string, deferralId: string, outcome: "PAID" | "CANCELLED") => {
    setPending(key);
    try { await adminResolveDeferral({ data: { deferralId, outcome } }); toast.success(outcome === "PAID" ? "Due cleared" : "Due cancelled"); await refreshDues(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not clear the due"); }
    finally { setPending(null); }
  };
  const assignable = d?.canGrantFounder ? ["editor", "reviewer", "founder", "admin"] : ["editor", "reviewer"];

  async function toggle(userId: string, role: "editor" | "reviewer" | "founder" | "admin", grant: boolean) {
    const before = qc.getQueryData<UserList>(key);
    // Shown at once; the server answer replaces it, and a refusal puts the old roles back.
    qc.setQueryData<UserList>(key, (old) => old && { ...old, rows: old.rows.map((u) => u.id !== userId ? u : { ...u, roles: (grant ? [...new Set([...u.roles, role])] : u.roles.filter((r) => r !== role)).sort() }) });
    setPending(`${userId}:${role}`);
    try {
      const r = await adminSetRole({ data: { userId, role, grant } });
      qc.setQueryData<UserList>(key, (old) => old && { ...old, rows: old.rows.map((u) => u.id !== userId ? u : { ...u, roles: r.roles.filter((x) => ["editor", "reviewer", "founder", "admin", "super_admin"].includes(x)).sort() }) });
      toast.success(`${grant ? "Allowed" : "Removed"} ${ROLE_LABEL[role]!.toLowerCase()} for ${r.email ?? "this user"}.`);
      // Everything else that shows roles refreshes in the background; nothing waits for it.
      void qc.invalidateQueries({ queryKey: ["me"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); void qc.invalidateQueries({ queryKey: ["reviewer-list"] });
    } catch (e) {
      qc.setQueryData<UserList | undefined>(key, before);
      toast.error(e instanceof Error ? e.message : "Could not change the role");
    } finally { setPending(null); }
  }

  const [reason, setReason] = useState("");
  async function setBlock(userId: string, blocked: boolean) {
    const before = qc.getQueryData<UserList>(key);
    qc.setQueryData<UserList>(key, (old) => old && { ...old, rows: old.rows.map((u) => u.id !== userId ? u : { ...u, blocked }) });
    setPending(`${userId}:block`);
    try {
      await adminSetUserBlock({ data: { targetId: userId, blocked, message: blocked ? (reason.trim() || null) : null } });
      announceSiteChange();
      toast.success(blocked ? "Access paused for this person. They see it within a few seconds." : "Access restored.");
    } catch (e) {
      qc.setQueryData<UserList | undefined>(key, before);
      toast.error(e instanceof Error ? e.message : "Could not change the block");
    } finally { setPending(null); }
  }

  return (
    <div>
      <h2 className="border-b border-border pb-2 text-[1.5rem]">Users and roles</h2>
      <p className="mt-3 max-w-[70ch] text-[15px]">Everyone who has registered. Click a person to give or remove a role.{d && !d.canGrantFounder ? " You can allow editors and reviewers." : " Administrators can also make a founder or one more administrator (two administrators at most)."}</p>
      {dues.isError && <p role="alert" className="mt-4 text-destructive">{dues.error instanceof Error ? dues.error.message : "Could not load dues"}</p>}
      {dues.data && dues.data.rows.length > 0 && (
        <section aria-label="Dues pending" className="mt-5 border border-destructive/40 bg-destructive/5 p-4">
          <h3 className="text-base font-semibold">Dues pending ({dues.data.rows.length})</h3>
          <ul className="mt-2 divide-y divide-border">
            {dues.data.rows.map((h) => (
              <li key={h.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-0"><span className="block truncate font-semibold">{h.name ?? h.email}</span>{h.name && <span className="block truncate text-xs text-muted-foreground">{h.email}</span>}</span>
                <span className="text-right">
                  <span className="block font-medium">{h.amount_minor !== null && h.currency ? `${h.currency} ${(h.amount_minor / 100).toFixed(2)}` : h.note ?? "Amount not noted"}</span>
                  {h.due_at ? <span className={`block text-xs ${h.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{h.overdue ? "Overdue, was due " : "Due "}{fmtDate(h.due_at)}</span> : h.since ? <span className="block text-xs text-muted-foreground">Hold since {fmtDate(h.since)}</span> : null}
                </span>
                <span className="flex w-full flex-wrap justify-end gap-2">
                  {h.kind === "deferral" && h.deferralId ? (
                    <>
                      <Button size="sm" disabled={pending !== null} aria-busy={pending === h.key} onClick={async () => { if (!window.confirm(`Mark this due as paid (received outside checkout)?\n${h.name ?? h.email}`)) return; await resolveDue(h.key, h.deferralId!, "PAID"); }}>Clear due (paid)</Button>
                      <Button size="sm" variant="outline" disabled={pending !== null} onClick={async () => { if (!window.confirm(`Cancel this due (write it off)?\n${h.name ?? h.email}`)) return; await resolveDue(h.key, h.deferralId!, "CANCELLED"); }}>Cancel due</Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={pending !== null} aria-busy={pending === h.key} onClick={async () => { if (!window.confirm(`Lift the dues hold for ${h.name ?? h.email}?`)) return; setPending(h.key); try { await adminSetFounderDues({ data: { userId: h.id, due: false } }); toast.success("Hold lifted"); await refreshDues(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not lift the hold"); } finally { setPending(null); } }}>Clear hold</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); setPage(1); }}>
        <label className="text-sm font-medium">Search by name or email<input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or name@example.com" /></label>
        <Button type="submit" variant="outline">Search</Button>
        {applied && <Button type="button" variant="ghost" onClick={() => { setQ(""); setApplied(""); setPage(1); }}>Clear</Button>}
      </form>
      {users.isLoading && <p className="mt-4 text-muted-foreground">Loading…</p>}
      {users.isError && <p role="alert" className="mt-4 text-destructive">{users.error instanceof Error ? users.error.message : "Could not load users"}</p>}
      {d && (
        <>
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {d.rows.map((u) => (
              <li key={u.id}>
                <button type="button" aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-wash active:bg-wash">
                  <span className="min-w-0">
                    {/* The name people saved comes first; the e-mail sits under it, small. Someone who has not saved a name yet shows by e-mail alone. */}
                    <span className="block truncate font-semibold">{u.name ?? u.email}{u.blocked && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Blocked</span>}{(u.dueHold || u.dues.length > 0) && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{u.dues.some((x) => x.overdue) ? "Dues overdue" : "Dues pending"}</span>}</span>
                    {u.name && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}
                    {(u.dueHold || u.dues.length > 0) && <span className="block truncate text-xs font-medium text-destructive">Dues: {[...(u.dueHold ? [u.dueNote ?? "amount not noted"] : []), ...u.dues.map((x) => `${x.currency} ${(x.amount_minor / 100).toFixed(2)}${x.overdue ? " overdue" : ""}`)].join(" · ")}</span>}
                    <span className="block text-xs text-muted-foreground">joined {fmtDate(u.created_at)}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5 text-xs">{u.roles.length === 0 ? <span className="text-muted-foreground">no staff role</span> : u.roles.map((r) => <span key={r} className="rounded-full border border-border bg-background px-2 py-0.5 font-medium">{ROLE_LABEL[r] ?? r}</span>)}</span>
                </button>
                {open === u.id && (
                  <div className="flex flex-wrap gap-2 bg-wash px-4 py-3">
                    {assignable.map((r) => {
                      const has = u.roles.includes(r);
                      const self = u.id === d.selfId && !d.canGrantFounder;
                      const mine = pending === `${u.id}:${r}`;
                      return <Button key={r} size="sm" variant={has ? "outline" : "default"} disabled={pending !== null || self} aria-busy={mine} title={self ? "You cannot change your own roles" : undefined} onClick={() => void toggle(u.id, r as "editor", !has)}>{mine ? "Saving…" : has ? `Remove ${ROLE_LABEL[r]!.toLowerCase()}` : `Allow ${ROLE_LABEL[r]!.toLowerCase()}`}</Button>;
                    })}
                    {u.roles.includes("founder") && !u.roles.some((r) => r === "admin" || r === "super_admin") && (
                      <div className="mt-1 flex w-full flex-wrap items-center gap-2 border-t border-border pt-3">
                        <span className="text-xs text-muted-foreground">{u.dueHold ? "This founder's data and founder actions are blocked until you lift the hold." : "Dues pending? Blocks this founder's data and founder actions. Admins are never affected."}</span>
                        <Button size="sm" variant={u.dueHold ? "default" : "destructive"} disabled={pending !== null} aria-busy={pending === `${u.id}:dues`} onClick={async () => { setPending(`${u.id}:dues`); try { const note = u.dueHold ? null : window.prompt("Note the founder will see with the block, e.g. the amount due (optional)"); if (note === null && !u.dueHold) { setPending(null); return; } await adminSetFounderDues({ data: { userId: u.id, due: !u.dueHold, ...(note?.trim() ? { note: note.trim() } : {}) } }); toast.success(u.dueHold ? "Hold lifted" : "Founder access paused"); await qc.invalidateQueries({ queryKey: ["role-users"] }); await qc.invalidateQueries({ queryKey: ["dues-holds"] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not change the hold"); } finally { setPending(null); } }}>{pending === `${u.id}:dues` ? "Saving…" : u.dueHold ? "Lift dues hold" : "Place dues hold"}</Button>
                        {u.dueHold && <Button size="sm" variant="outline" disabled={pending !== null} onClick={async () => { const note = window.prompt("Dues note the founder sees (e.g. the amount due)", u.dueNote ?? ""); if (note === null) return; setPending(`${u.id}:dues`); try { await adminSetFounderDues({ data: { userId: u.id, due: true, ...(note.trim() ? { note: note.trim() } : {}) } }); toast.success("Dues note updated"); await qc.invalidateQueries({ queryKey: ["role-users"] }); await qc.invalidateQueries({ queryKey: ["dues-holds"] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the note"); } finally { setPending(null); } }}>Edit dues note</Button>}
                      </div>
                    )}
                    {u.id !== d.selfId && !u.roles.some((r) => r === "admin" || r === "super_admin") && (
                      <div className="mt-1 flex w-full flex-wrap items-center gap-2 border-t border-border pt-3">
                        {!u.blocked && <input className="flex h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm sm:max-w-sm" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Message they will see (optional)" aria-label="Message the blocked person sees" />}
                        <Button size="sm" variant={u.blocked ? "default" : "destructive"} disabled={pending !== null} aria-busy={pending === `${u.id}:block`} onClick={() => void setBlock(u.id, !u.blocked)}>{pending === `${u.id}:block` ? "Saving…" : u.blocked ? "Restore access" : "Block this person"}</Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
            {d.rows.length === 0 && <li className="py-4 text-muted-foreground">No users found.</li>}
          </ul>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{d.total} user{d.total === 1 ? "" : "s"}</span>
            <span className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>Next</Button></span>
          </div>
        </>
      )}
    </div>
  );
}
