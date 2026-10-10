// What each e-mail says. Pure and tested (email-templates.test.ts). Every dynamic value is HTML-escaped.
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Notification kinds that are also e-mailed. Internal staff notices (payment_review, review_submitted, ...) stay in-app only. */
export function shouldEmail(kind: string): boolean {
  if (kind === "payment_review") return false;
  if (kind === "certificate_issued") return false; // sent separately, with the PDF attached
  if (kind.startsWith("payment_") || kind.startsWith("decision_")) return true;
  return [
    "submission_received", "screening_complete", "status_update", "tracked_change_proposed", "published", "notice",
    "review_invitation", "review_deadline", "revision_received", "submission_withdrawn",
  ].includes(kind);
}

interface Copy { subject: string; heading: string; cta: string }
const COPY: Record<string, Copy> = {
  submission_received: { subject: "We received your research paper", heading: "Your research paper was submitted", cta: "View your submission" },
  screening_complete: { subject: "Automated screening is complete", heading: "Automated screening is complete", cta: "View your submission" },
  status_update: { subject: "Update on your research paper", heading: "Your research paper has a new status", cta: "View your submission" },
  tracked_change_proposed: { subject: "The editor changed your manuscript", heading: "The editor made a tracked change", cta: "Review the changes" },
  decision_accepted: { subject: "Your research paper has been approved", heading: "Your research paper has been approved", cta: "View the decision" },
  decision_rejected: { subject: "Decision on your research paper", heading: "The editor has disapproved your research paper", cta: "View the decision" },
  decision_revision_required: { subject: "Changes requested on your research paper", heading: "The editor asks for changes", cta: "View the requested changes" },
  published: { subject: "Your work is published", heading: "Your work is published", cta: "Open the published record" },
  notice: { subject: "A notice was issued on your record", heading: "A notice was issued on your record", cta: "Open the record" },
  review_invitation: { subject: "Invitation to review a manuscript", heading: "You are invited to review", cta: "Respond to the invitation" },
  certificate_issued: { subject: "Your certificate", heading: "Your certificate is ready", cta: "Verify the certificate" },
  revision_received: { subject: "We received your revised manuscript", heading: "Your revision was received", cta: "View your submission" },
  submission_withdrawn: { subject: "Your submission was withdrawn", heading: "Your submission was withdrawn", cta: "View your submission" },
  review_deadline: { subject: "Your review deadline changed", heading: "Your review deadline changed", cta: "Open my reviews" },
};

export interface RenderInput { kind: string; title: string; body: string; link?: string | null | undefined; siteUrl: string; recipientName?: string | null | undefined; brand?: string }

export function renderEmail(i: RenderInput): { subject: string; text: string; html: string } {
  const brand = i.brand ?? "Paperly";
  const c = COPY[i.kind] ?? (i.kind.startsWith("payment_") ? { subject: i.title, heading: i.title, cta: "View payment details" } : { subject: i.title, heading: i.title, cta: "Open" });
  const base = i.siteUrl.replace(/\/+$/, "");
  const url = i.link ? (/^https?:\/\//i.test(i.link) ? i.link : base ? `${base}${i.link.startsWith("/") ? "" : "/"}${i.link}` : "") : "";
  const hello = i.recipientName?.trim() ? `Hello ${i.recipientName.trim()},` : "Hello,";
  const subject = `[${brand}] ${c.subject}`;
  const foot = `You are receiving this because it concerns a manuscript submitted with your ${brand} account. Replies to this address are not monitored for decisions; sign in to act on this update.`;
  const text = [hello, "", c.heading, "", i.body, ...(url ? ["", `${c.cta}: ${url}`] : []), "", "—", brand, foot].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:Georgia,'Times New Roman',serif;color:#1b1b1b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #dcdcd6;border-radius:6px" cellpadding="0" cellspacing="0">
<tr><td style="padding:20px 28px;border-bottom:1px solid #e6e6e0;font:600 18px Georgia,serif">${esc(brand)}</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px;font:15px Arial,sans-serif">${esc(hello)}</p>
<h1 style="margin:0 0 16px;font:600 21px/1.3 Georgia,serif">${esc(c.heading)}</h1>
<p style="margin:0 0 20px;font:15px/1.6 Arial,sans-serif;white-space:pre-line">${esc(i.body)}</p>
${url ? `<p style="margin:0 0 8px"><a href="${esc(url)}" style="display:inline-block;background:#1f4e3d;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:4px;font:600 15px Arial,sans-serif">${esc(c.cta)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e6e6e0;font:12px/1.5 Arial,sans-serif;color:#666">${esc(foot)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function renderCertificateEmail(i: { certificateId: string; type: string; paperTitle: string; siteUrl: string; verifyUrl?: string | undefined; recipientName?: string | undefined; brand?: string }) {
  const label = i.type.replace(/_/g, " ").toLowerCase();
  const body = `Your ${label} certificate ${i.certificateId} for “${i.paperTitle}” is attached as a PDF.${i.verifyUrl ? `\n\nAnyone can verify it at the link below.` : ""}`;
  const r = renderEmail({ kind: "certificate_issued", title: "Your certificate", body, link: i.verifyUrl ?? "/certificates", siteUrl: i.siteUrl, recipientName: i.recipientName, ...(i.brand ? { brand: i.brand } : {}) });
  const brand = i.brand ?? "Paperly";
  return { ...r, subject: `[${brand}] Your ${label} certificate ${i.certificateId}` };
}
