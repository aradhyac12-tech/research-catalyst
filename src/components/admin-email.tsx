import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminDraftEmail, adminEmailHistory, adminEmailRecipients, adminSendEmail } from "@/lib/admin-mail.functions";
import { BODY_MAX, SUBJECT_MAX } from "@/lib/domain/admin-email";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/ui";
import { meQuery } from "@/lib/queries";

const input = "flex h-11 w-full rounded-lg border border-input bg-background px-3 text-base";
type Tone = "friendly" | "formal" | "firm";

/** Administrators only. Pick a person, describe what the message must say, let the AI write a draft, edit it, then send. The AI never sends. */
export function AdminEmail() {
  const me = useQuery({ ...meQuery(), staleTime: 10_000 });
  const isAdmin = (me.data?.roles ?? []).some((x) => x === "admin" || x === "super_admin");
  return isAdmin ? <AdminEmailPanel /> : null;
}

function AdminEmailPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState(""); const [applied, setApplied] = useState(""); const [page, setPage] = useState(1); const [recent, setRecent] = useState(true);
  const [to, setTo] = useState<{ id: string; email: string; name: string | null } | null>(null);
  const [tone, setTone] = useState<Tone>("friendly");
  const [instr, setInstr] = useState("");
  const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [drafting, setDrafting] = useState(false); const [sending, setSending] = useState(false);
  const [fromAi, setFromAi] = useState(false);
  const users = useQuery({ queryKey: ["mail-users", applied, page, recent], queryFn: () => adminEmailRecipients({ data: { ...(applied ? { q: applied } : {}), page, recent } }), enabled: !to, retry: false, staleTime: 0 });
  const pages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.pageSize)) : 1;
  const history = useQuery({ queryKey: ["admin-email-history"], queryFn: () => adminEmailHistory({ data: {} }), retry: false });

  async function draft() {
    if (!to) return;
    setDrafting(true);
    try {
      const d = await adminDraftEmail({ data: { userId: to.id, instructions: instr, tone } });
      setSubject(d.subject); setBody(d.body); setFromAi(true);
      toast.success("Draft written. Read it and edit it before you send.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not write a draft"); } finally { setDrafting(false); }
  }
  async function send() {
    if (!to) return;
    if (!window.confirm(`Send this e-mail to ${to.email}?`)) return;
    setSending(true);
    try {
      const r = await adminSendEmail({ data: { userId: to.id, subject, body, draftId } });
      toast.success(r.status === "SENT" ? "E-mail sent" : "E-mail queued. It will be retried automatically.");
      setSubject(""); setBody(""); setInstr(""); setFromAi(false); setDraftId(crypto.randomUUID());
      await qc.invalidateQueries({ queryKey: ["admin-email-history"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not send the e-mail"); } finally { setSending(false); }
  }

  return (
    <section aria-labelledby="mail-h" className="space-y-4">
      <h2 id="mail-h" className="border-b border-border pb-2 text-[1.5rem]">E-mail a user</h2>
      <p className="max-w-[70ch] text-[15px] text-muted-foreground">Write to one registered user from the Paperly address. The AI can draft the message from your notes; you always read, edit and send it yourself. The AI sees only the person's first name.</p>

      {!to ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Who to show">
            <Button size="sm" variant={recent ? "default" : "outline"} onClick={() => { setRecent(true); setPage(1); }}>Signed in last 7 days</Button>
            <Button size="sm" variant={!recent ? "default" : "outline"} onClick={() => { setRecent(false); setPage(1); }}>All users</Button>
          </div>
          <form className="flex max-w-lg gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); setPage(1); }}>
            <input className={input} placeholder="Filter by name or e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter users" />
            <Button type="submit" variant="outline">Filter</Button>
          </form>
          {users.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {users.isError && <p role="alert" className="text-sm text-destructive">Could not load users.</p>}
          {users.data && users.data.rows.length === 0 && <p className="text-sm text-muted-foreground">{recent ? "No one has signed in during the last 7 days." : "No one matches."}</p>}
          <ul className="divide-y divide-border">
            {(users.data?.rows ?? []).map((u) => (
              <li key={u.id}><button className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-wash" onClick={() => setTo({ id: u.id, email: u.email, name: u.name })}><span className="min-w-0"><span className="font-medium">{u.name ?? "(no name)"}</span><span className="block break-all text-sm text-muted-foreground">{u.email}</span></span><span className="text-xs text-muted-foreground">{u.lastSignIn ? `signed in ${fmtDate(u.lastSignIn)}` : "never signed in"}</span></button></li>
            ))}
          </ul>
          {pages > 1 && <div className="flex items-center gap-3 text-sm"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[15px]">To: <span className="font-semibold">{to.name ?? "(no name)"}</span> <span className="text-muted-foreground">{to.email}</span></p><Button size="sm" variant="outline" onClick={() => { setTo(null); setSubject(""); setBody(""); setInstr(""); setFromAi(false); }}>Change person</Button></div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">What should the e-mail say? <span className="font-normal text-muted-foreground">(your notes, in any wording)</span>
              <Textarea rows={3} maxLength={1500} value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="For example: Tell her the publication fee for her paper is waived and she can now upload." />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium">Tone<select className={input + " w-40"} value={tone} onChange={(e) => setTone(e.target.value as Tone)}><option value="friendly">Friendly</option><option value="formal">Formal</option><option value="firm">Firm</option></select></label>
              <Button variant="outline" disabled={drafting || instr.trim().length < 10} onClick={draft}>{drafting ? "Writing…" : subject || body ? "Write again with AI" : "Write with AI"}</Button>
            </div>
          </div>
          <label className="block text-sm font-medium">Subject<input className={input} maxLength={SUBJECT_MAX} value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="block text-sm font-medium">Message<Textarea rows={10} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          {fromAi && <p className="text-xs text-caution">Written by AI from your notes. Check every fact, amount and date before sending.</p>}
          <div className="flex items-center gap-3"><Button disabled={sending || subject.trim().length < 3 || body.trim().length < 10} onClick={send}>{sending ? "Sending…" : "Send e-mail"}</Button><span className="text-xs text-muted-foreground">{body.length}/{BODY_MAX}</span></div>
        </div>
      )}

      {(history.data?.length ?? 0) > 0 && (
        <div><h3 className="text-[1.0625rem]">Recently sent</h3>
          <ul className="divide-y divide-border border-y border-border text-sm">
            {history.data!.map((h) => <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0"><span className="font-medium">{h.subject}</span><span className="block text-xs text-muted-foreground">{h.to}, {fmtDate(h.created_at)}</span></span><span className="text-xs uppercase tracking-wide text-muted-foreground">{h.status === "SENT" ? "sent" : h.status === "DEAD" ? "failed" : "queued"}</span></li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
