import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminListPaperAuthorCertificates, adminPauseAuthorCertificate, adminResumeAuthorCertificate, adminEditArticleTitle, adminEditAuthor, adminDeleteAuthorCertificate } from "@/lib/article-removal.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/ui";

/** Waits for a save, but never forever: if the server is slow the panel is released and the admin is told to check, so no button stays disabled. */
function withTimeout<T>(p: Promise<T>, ms = 90_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("This is taking longer than expected. The change may still finish; refresh the list in a minute to check.")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Administrators only. Lists a paper's authors and lets an administrator pause (or resume) one author's certificate without touching the others. */
export function AuthorCertificatesPanel({ paperId, publicId }: { paperId: string; publicId: string }) {
  const [open, setOpen] = useState(false);
  const [startTitle, setStartTitle] = useState(false); // opened from the row's "Edit name" button
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Which inline form is open: "title", or "edit:<authorId>" / "delete:<authorId>".
  const [form, setForm] = useState<string | null>(null);
  const [fName, setFName] = useState(""); const [fEmail, setFEmail] = useState(""); const [fReason, setFReason] = useState(""); const [fResend, setFResend] = useState(true);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["author-certs", paperId], queryFn: () => adminListPaperAuthorCertificates({ data: { paperId } }), enabled: open, retry: false });

  useEffect(() => {
    if (startTitle && q.data) { setForm("title"); setFName(q.data.title); setFReason(""); setFResend(true); setStartTitle(false); }
  }, [startTitle, q.data]);

  async function pause(authorId: string, name: string) {
    setBusy(authorId);
    try {
      const r = await adminPauseAuthorCertificate({ data: { authorId, reason } });
      toast.success(`Certificate for ${name} paused`);
      if (r.alreadyEmailed) toast.message("Certificate e-mails for this paper were already sent. Those e-mails cannot be recalled, but the certificate no longer verifies or downloads.");
      setEditing(null); setReason("");
      await qc.invalidateQueries({ queryKey: ["author-certs", paperId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not pause"); } finally { setBusy(null); }
  }
  async function resume(authorId: string, name: string) {
    setBusy(authorId);
    try {
      const r = await adminResumeAuthorCertificate({ data: { authorId } });
      toast.success(r.issued ? `Certificate for ${name} released and sent` : `Certificate for ${name} released`);
      await qc.invalidateQueries({ queryKey: ["author-certs", paperId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not resume"); } finally { setBusy(null); }
  }

  function openForm(key: string, name = "", email = "") {
    setForm(key); setFName(name); setFEmail(email); setFReason(""); setFResend(true); setEditing(null);
    // Bring the form into view; on a phone it can otherwise open off-screen and the button looks dead.
    setTimeout(() => document.getElementById(`form-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }
  const refresh = () => qc.invalidateQueries({ queryKey: ["author-certs", paperId] });
  function done(r: { replaced: number; failed: number; emailed: boolean }, what: string) {
    if (!r.replaced && !r.failed) { if (r.emailed) toast.success("Certificates e-mailed to every address on record."); else toast.message("Nothing new to send: every address on record already has the current certificates."); return; }
    toast.success(r.replaced ? `${what}. ${r.replaced} certificate${r.replaced === 1 ? "" : "s"} re-issued${r.emailed ? " and e-mailed" : ""}.` : `${what}.`);
    if (r.failed) toast.error(`${r.failed} certificate${r.failed === 1 ? "" : "s"} could not be re-issued. The old one is still valid; try again.`);
  }
  async function saveTitle() {
    setBusy("title");
    try { const r = await withTimeout(adminEditArticleTitle({ data: { paperId, title: fName, reason: fReason, resend: fResend } })); done(r, "Article name corrected"); if (r.hasDoi) toast.message("This paper has a DOI. Update the title in the DOI record (Zenodo) as well."); setForm(null); await refresh(); qc.invalidateQueries({ queryKey: ["admin-articles"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not change the name"); } finally { setBusy(null); }
  }
  async function saveAuthor(authorId: string) {
    setBusy(authorId);
    try { const r = await withTimeout(adminEditAuthor({ data: { authorId, fullName: fName, email: fEmail, reason: fReason, resend: fResend } })); done(r, "Author corrected"); setForm(null); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not change the author"); } finally { setBusy(null); }
  }
  async function removeCert(authorId: string, name: string) {
    setBusy(authorId);
    try {
      const r = await withTimeout(adminDeleteAuthorCertificate({ data: { authorId, reason: fReason } }));
      toast.success(`Certificate for ${name} deleted`);
      if (r.alreadyEmailed) toast.message("Certificate e-mails for this paper were already sent. Those e-mails cannot be recalled, but the certificate no longer verifies or downloads.");
      setForm(null); await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); } finally { setBusy(null); }
  }

  if (!open) return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setStartTitle(true); setOpen(true); }} aria-label={`Edit article name for ${publicId}`}>Edit name</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Edit or delete author certificates for ${publicId}`}>Edit / delete author certificates</Button>
    </>
  );
  return (
    <div className="w-full min-w-0 max-w-2xl space-y-3 border border-border bg-background p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">Author certificates · {publicId}</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
      <p className="text-sm text-muted-foreground">Every author gets their own certificate. Pausing one author's certificate means they receive no certificate and no certificate e-mail, and an existing one stops verifying and downloading, until you resume it. The other authors are not affected. The reason stays internal and the author is not told.</p>
      {q.data && (
        <div className="space-y-2 border border-border p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 sm:flex-1"><div className="text-sm text-muted-foreground">Article name</div><div className="break-words font-medium">{q.data.title}</div></div>
            <Button type="button" size="sm" variant="outline" onClick={() => { setBusy(null); openForm("title", q.data?.title ?? ""); }}>Edit name</Button>
          </div>
          {form === "title" && (
            <div id="form-title" className="space-y-2">
              <label htmlFor={`title-${paperId}`} className="block text-sm font-medium">Corrected article name</label>
              <Textarea id={`title-${paperId}`} rows={2} maxLength={500} value={fName} onChange={(e) => setFName(e.target.value)} disabled={busy !== null} />
              <ReasonAndSend id={`tr-${paperId}`} reason={fReason} setReason={setFReason} resend={fResend} setResend={setFResend} disabled={busy !== null} />
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={busy !== null || fName.trim().length < 3 || fReason.trim().length < 5} onClick={saveTitle}>{busy === "title" ? "Saving, re-issuing certificates (up to 30 s)…" : "Save and re-issue certificates"}</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setForm(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : q.isError ? <p role="alert" className="text-sm">Could not load the authors.</p> : (
        <>
          {!q.data?.published && <p role="note" className="rounded-lg border border-caution bg-caution-soft px-3 py-2 text-sm">This paper is not published yet. Certificates are issued at publication; a paused author will be skipped then.</p>}
          <ul className="divide-y divide-border border-y border-border">
            {(q.data?.authors ?? []).map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 sm:flex-1">
                    <div className="break-words font-medium">{a.position}. {a.fullName}{a.isUploader ? " (uploader)" : ""}</div>
                    <div className="break-words text-sm text-muted-foreground">{a.email || "No email given"}</div>
                    <div className="mt-1 text-sm">
                      {a.onHold ? <span className="font-medium">{a.holdReason?.startsWith("Deleted:") ? "Deleted" : "Paused"}{a.heldAt ? ` ${fmtDate(a.heldAt)}` : ""}: {a.holdReason?.replace(/^Deleted: /, "")}</span>
                        : a.certificates.length ? <span className="text-muted-foreground">{a.certificates.map((c) => `${c.certificateId}${c.status === "VALID" ? "" : ` (${c.status.toLowerCase()})`}`).join(", ")}</span>
                        : <span className="text-muted-foreground">No certificate issued yet</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:shrink-0">
                    <Button type="button" size="sm" variant="outline" onClick={() => { setBusy(null); openForm(`edit:${a.id}`, a.fullName, a.email ?? ""); }}>Edit</Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => { setBusy(null); openForm(`delete:${a.id}`); }}>Delete</Button>
                    {a.onHold
                      ? <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => resume(a.id, a.fullName)}>{busy === a.id ? "Releasing…" : a.holdReason?.startsWith("Deleted:") ? "Issue again" : "Resume certificate"}</Button>
                      : <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => { setForm(null); setEditing(editing === a.id ? null : a.id); setReason(""); }}>Pause certificate</Button>}
                  </div>
                </div>
                {form === `edit:${a.id}` && (
                  <div id={`form-edit:${a.id}`} className="space-y-2">
                    <label htmlFor={`an-${a.id}`} className="block text-sm font-medium">Corrected author name (as it should appear on the certificate)</label>
                    <Input id={`an-${a.id}`} maxLength={200} value={fName} onChange={(e) => setFName(e.target.value)} disabled={busy !== null} />
                    <label htmlFor={`ae-${a.id}`} className="block text-sm font-medium">E-mail (leave as is, or correct it so the new certificate goes to the right inbox)</label>
                    <Input id={`ae-${a.id}`} type="email" maxLength={254} value={fEmail} onChange={(e) => setFEmail(e.target.value)} disabled={busy !== null} />
                    <ReasonAndSend id={`ar-${a.id}`} reason={fReason} setReason={setFReason} resend={fResend} setResend={setFResend} disabled={busy !== null} />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={busy !== null || fName.trim().length < 2 || fReason.trim().length < 5} onClick={() => saveAuthor(a.id)}>{busy === a.id ? "Saving, re-issuing certificates (up to 30 s)…" : "Save and re-issue certificate"}</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setForm(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                {form === `delete:${a.id}` && (
                  <div id={`form-delete:${a.id}`} className="space-y-2">
                    <p className="text-sm">This revokes every certificate of {a.fullName} on this paper. It stops verifying and downloading, and none is issued again until you choose "Issue again". Nothing is erased from the record.</p>
                    <label htmlFor={`dr-${a.id}`} className="block text-sm font-medium">Reason (internal, recorded in the audit log)</label>
                    <Textarea id={`dr-${a.id}`} rows={2} maxLength={500} value={fReason} onChange={(e) => setFReason(e.target.value)} disabled={busy !== null} />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="destructive" disabled={busy !== null || fReason.trim().length < 5} onClick={() => removeCert(a.id, a.fullName)}>{busy === a.id ? "Deleting…" : "Confirm delete"}</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setForm(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                {editing === a.id && !a.onHold && (
                  <div className="space-y-2">
                    <label htmlFor={`pause-${a.id}`} className="block text-sm font-medium">Reason (internal, recorded in the audit log)</label>
                    <Textarea id={`pause-${a.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy !== null} />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="destructive" disabled={busy !== null || reason.trim().length < 5} onClick={() => pause(a.id, a.fullName)}>{busy === a.id ? "Pausing…" : "Confirm pause"}</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReasonAndSend({ id, reason, setReason, resend, setResend, disabled }: { id: string; reason: string; setReason: (v: string) => void; resend: boolean; setResend: (v: boolean) => void; disabled: boolean }) {
  return (
    <>
      <label htmlFor={id} className="block text-sm font-medium">Reason (internal, recorded in the audit log)</label>
      <Textarea id={id} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={resend} onChange={(e) => setResend(e.target.checked)} disabled={disabled} /><span>E-mail the corrected certificates to the authors. The old certificates stay on record as "superseded" and are replaced by new IDs.</span></label>
    </>
  );
}
