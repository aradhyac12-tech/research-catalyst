import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminListPaperAuthorCertificates, adminPauseAuthorCertificate, adminResumeAuthorCertificate } from "@/lib/article-removal.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/ui";

/** Administrators only. Lists a paper's authors and lets an administrator pause (or resume) one author's certificate without touching the others. */
export function AuthorCertificatesPanel({ paperId, publicId }: { paperId: string; publicId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["author-certs", paperId], queryFn: () => adminListPaperAuthorCertificates({ data: { paperId } }), enabled: open, retry: false });

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

  if (!open) return <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Author certificates for ${publicId}`}>Author certificates</Button>;
  return (
    <div className="w-full max-w-2xl space-y-3 border border-border bg-background p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">Author certificates · {publicId}</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
      <p className="text-sm text-muted-foreground">Every author gets their own certificate. Pausing one author's certificate means they receive no certificate and no certificate e-mail, and an existing one stops verifying and downloading, until you resume it. The other authors are not affected. The reason stays internal and the author is not told.</p>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : q.isError ? <p role="alert" className="text-sm">Could not load the authors.</p> : (
        <>
          {!q.data?.published && <p role="note" className="rounded-lg border border-caution bg-caution-soft px-3 py-2 text-sm">This paper is not published yet. Certificates are issued at publication; a paused author will be skipped then.</p>}
          <ul className="divide-y divide-border border-y border-border">
            {(q.data?.authors ?? []).map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-words font-medium">{a.position}. {a.fullName}{a.isUploader ? " (uploader)" : ""}</div>
                    <div className="break-all text-sm text-muted-foreground">{a.email || "No email given"}</div>
                    <div className="mt-1 text-sm">
                      {a.onHold ? <span className="font-medium">Paused{a.heldAt ? ` ${fmtDate(a.heldAt)}` : ""}: {a.holdReason}</span>
                        : a.certificates.length ? <span className="text-muted-foreground">{a.certificates.map((c) => c.certificateId).join(", ")}</span>
                        : <span className="text-muted-foreground">No certificate issued yet</span>}
                    </div>
                  </div>
                  {a.onHold
                    ? <Button type="button" size="sm" variant="outline" disabled={busy === a.id} onClick={() => resume(a.id, a.fullName)}>{busy === a.id ? "Resuming…" : "Resume certificate"}</Button>
                    : <Button type="button" size="sm" variant="destructive" disabled={busy !== null} onClick={() => { setEditing(editing === a.id ? null : a.id); setReason(""); }}>Pause certificate</Button>}
                </div>
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
