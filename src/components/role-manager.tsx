import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listUsersForRoles } from "@/lib/founder.functions";
import { adminSetRole } from "@/lib/review.functions";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/ui";

const ROLE_LABEL: Record<string, string> = { editor: "Editor", reviewer: "Reviewer", founder: "Founder", admin: "Admin", super_admin: "Super admin" };
const input = "flex h-11 w-full max-w-sm rounded-[2px] border border-input bg-background px-3 text-base";

/** Registered users with their roles. Click a person to allow or remove a role. What each caller may do is decided on the server:
 *  administrators can allow editor, reviewer and founder; a founder can allow only editor and reviewer, and not for themselves. */
export function RoleManager() {
  const qc = useQueryClient();
  const [q, setQ] = useState(""); const [applied, setApplied] = useState(""); const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const users = useQuery({ queryKey: ["role-users", applied, page], queryFn: () => listUsersForRoles({ data: { ...(applied ? { q: applied } : {}), page } }), retry: false, staleTime: 0 });
  const d = users.data;
  const assignable = d?.canGrantFounder ? ["editor", "reviewer", "founder"] : ["editor", "reviewer"];

  async function toggle(userId: string, role: "editor" | "reviewer" | "founder", grant: boolean) {
    setBusy(true);
    try {
      const r = await adminSetRole({ data: { userId, role, grant } });
      toast.success(`${grant ? "Allowed" : "Removed"} ${ROLE_LABEL[role]!.toLowerCase()} for ${r.email ?? "this user"}.`);
      await Promise.all([users.refetch(), qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["dashboard"] }), qc.invalidateQueries({ queryKey: ["reviewer-list"] })]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not change the role"); } finally { setBusy(false); }
  }

  return (
    <div>
      <h2 className="border-b border-border pb-2 text-[1.5rem]">Users and roles</h2>
      <p className="mt-3 max-w-[70ch] text-[15px]">Everyone who has registered. Click a person to give or remove a role.{d && !d.canGrantFounder ? " You can allow editors and reviewers." : " Administrators can also make a founder."}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); setPage(1); }}>
        <label className="text-sm font-medium">Search by email or name<input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="name@example.com" /></label>
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
                <button type="button" aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-wash">
                  <span className="min-w-0"><span className="block truncate font-medium">{u.email}</span><span className="block text-sm text-muted-foreground">{u.name ? `${u.name} · ` : ""}joined {fmtDate(u.created_at)}</span></span>
                  <span className="flex flex-wrap gap-1.5 text-xs">{u.roles.length === 0 ? <span className="text-muted-foreground">no staff role</span> : u.roles.map((r) => <span key={r} className="rounded-full border border-border bg-background px-2 py-0.5 font-medium">{ROLE_LABEL[r] ?? r}</span>)}</span>
                </button>
                {open === u.id && (
                  <div className="flex flex-wrap gap-2 bg-wash px-4 py-3">
                    {assignable.map((r) => {
                      const has = u.roles.includes(r);
                      const self = u.id === d.selfId && !d.canGrantFounder;
                      return <Button key={r} size="sm" variant={has ? "outline" : "default"} disabled={busy || self} title={self ? "You cannot change your own roles" : undefined} onClick={() => toggle(u.id, r as "editor", !has)}>{has ? `Remove ${ROLE_LABEL[r]!.toLowerCase()}` : `Allow ${ROLE_LABEL[r]!.toLowerCase()}`}</Button>;
                    })}
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
