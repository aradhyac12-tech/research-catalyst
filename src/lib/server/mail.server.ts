// Gmail mail system. Notifications become rows in public.email_outbox, which are sent through the Gmail API and retried on failure.
// No npm dependency: the API is plain HTTPS. Secrets (GMAIL_*) are read from the server environment and never logged.
import { db, dbx, log } from "./core.server";
import { buildMime, isEmail, toBase64Url } from "@/lib/domain/gmail-mime";
import { renderCertificateEmail, renderEmail, shouldEmail } from "@/lib/domain/email-templates";

const BACKOFF_MIN = [1, 5, 30, 120, 720]; // minutes before attempt 2..6
const MAX_ATTEMPTS = 6;
const env = (k: string) => process.env[k]?.trim() || "";

// Two ways to send through the same Gmail account. An App Password (SMTP) needs no Google Cloud project or domain and never expires;
// OAuth (Gmail API) is the alternative for teams that already have a verified Google app.
const appPassword = () => env("GMAIL_APP_PASSWORD").replace(/\s+/g, "");
const oauthConfigured = () => Boolean(env("GMAIL_CLIENT_ID") && env("GMAIL_CLIENT_SECRET") && env("GMAIL_REFRESH_TOKEN"));
export const mailConfigured = () => isEmail(env("GMAIL_SENDER")) && (Boolean(appPassword()) || oauthConfigured());

async function sendMessage(mime: string, recipients: string[]): Promise<string> {
  if (appPassword()) {
    const { smtpSend } = await import("./smtp.server");
    return smtpSend({ user: env("GMAIL_SENDER"), pass: appPassword(), from: env("GMAIL_SENDER"), to: recipients, message: mime });
  }
  return gmailSend(toBase64Url(mime));
}
const siteUrl = () => env("PUBLIC_SITE_URL");
const brand = () => env("MAIL_FROM_NAME") || "Paperly";

let cached: { token: string; exp: number } | null = null;
async function accessToken(force = false): Promise<string> {
  if (!force && cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({ client_id: env("GMAIL_CLIENT_ID"), client_secret: env("GMAIL_CLIENT_SECRET"), refresh_token: env("GMAIL_REFRESH_TOKEN"), grant_type: "refresh_token" }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Gmail authorisation failed (${j.error ?? res.status})`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3000) * 1000 };
  return cached.token;
}

async function gmailSend(raw: string): Promise<string> {
  const post = async (t: string) => fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(15000),
  });
  let res = await post(await accessToken());
  if (res.status === 401) res = await post(await accessToken(true));
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !j.id) throw new Error(`Gmail send failed (${res.status}${j.error?.message ? `: ${j.error.message.slice(0, 120)}` : ""})`);
  return j.id;
}

/** Account address first (the one used to upload); the corresponding author's address from the form is copied when it differs. */
async function recipientFor(userId: string, link: string | null | undefined) {
  const { data: prof } = await db.from("profiles").select("email, display_name").eq("id", userId).maybeSingle();
  let to = (prof?.email ?? "").trim();
  if (!isEmail(to)) {
    const { data } = await db.auth.admin.getUserById(userId);
    to = (data?.user?.email ?? "").trim();
  }
  let paperId: string | null = null;
  const m = link?.match(/\/(?:my-research|manuscript)\/([0-9a-f-]{36})/i);
  if (m) paperId = m[1]!;
  else {
    const a = link?.match(/\/article\/([A-Za-z0-9-]+)/);
    if (a) paperId = ((await db.from("papers").select("id").eq("paperly_id", a[1]!).maybeSingle()).data?.id as string | undefined) ?? null;
  }
  let cc: string | null = null;
  if (paperId) {
    const { data: own } = await db.from("papers").select("owner_id").eq("id", paperId).maybeSingle();
    if (own?.owner_id === userId) {
      const { data: ca } = await db.from("paper_authors").select("email").eq("paper_id", paperId).eq("is_corresponding", true).maybeSingle();
      const e = (ca?.email ?? "").trim();
      if (isEmail(e) && e.toLowerCase() !== to.toLowerCase()) cc = e;
    }
  }
  return { to: isEmail(to) ? to : null, cc, name: (prof?.display_name as string | undefined) ?? "", paperId };
}

/** Called by notify() for every in-app notification. Never throws: a mail problem must not break the workflow that caused it. */
export async function queueNotificationEmail(n: { id: string; userId: string; kind: string; title: string; body: string; link?: string | null }) {
  try {
    if (!shouldEmail(n.kind)) return;
    if (!mailConfigured()) return; // notification keeps email_status NOT_CONFIGURED
    const r = await recipientFor(n.userId, n.link);
    if (!r.to) { await dbx.from("notifications").update({ email_status: "NO_ADDRESS" }).eq("id", n.id); return; }
    const mail = renderEmail({ kind: n.kind, title: n.title, body: n.body, link: n.link, siteUrl: siteUrl(), recipientName: r.name, brand: brand() });
    const ins = await dbx.from("email_outbox").upsert({ dedupe_key: `notif:${n.id}`, user_id: n.userId, notification_id: n.id, paper_id: r.paperId, kind: n.kind, to_email: r.to, cc_email: r.cc, subject: mail.subject, text_body: mail.text, html_body: mail.html }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (ins.error) throw new Error(ins.error.message);
    await dbx.from("notifications").update({ email_status: "QUEUED" }).eq("id", n.id);
    const id = ins.data?.[0]?.id as string | undefined;
    if (id) await deliver(id);
    await processOutbox(3); // opportunistic retry of anything that failed earlier
  } catch (e) { log("mail_queue_failed", { kind: n.kind, error: e instanceof Error ? e.message : "unknown" }); }
}

/** Certificate e-mail with the PDF attached (read from private storage at send time, so a retry needs no state). */
export async function queueCertificateEmail(certUuid: string) {
  try {
    if (!mailConfigured()) return;
    const { data: c } = await db.from("certificates").select("id, certificate_id, certificate_type, paper_id, recipient_user_id, paper_title_at_issue, storage_path, verification_token, recipient_name_at_issue").eq("id", certUuid).single();
    if (!c?.storage_path) return;
    const r = await recipientFor(c.recipient_user_id, `/my-research/${c.paper_id}`);
    if (!r.to) return;
    const mail = renderCertificateEmail({ certificateId: c.certificate_id, type: c.certificate_type, paperTitle: c.paper_title_at_issue, siteUrl: siteUrl(), recipientName: c.recipient_name_at_issue, brand: brand(), verifyUrl: `${siteUrl()}/verify/certificate/${c.certificate_id}?t=${c.verification_token}` });
    const ins = await dbx.from("email_outbox").upsert({ dedupe_key: `cert:${c.id}`, user_id: c.recipient_user_id, paper_id: c.paper_id, kind: "certificate_issued", to_email: r.to, cc_email: r.cc, subject: mail.subject, text_body: mail.text, html_body: mail.html, attachment_bucket: "certificates", attachment_path: c.storage_path, attachment_name: `${c.certificate_id}.pdf` }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (ins.error) throw new Error(ins.error.message);
    const id = ins.data?.[0]?.id as string | undefined;
    if (id) await deliver(id);
  } catch (e) { log("mail_certificate_queue_failed", { error: e instanceof Error ? e.message : "unknown" }); }
}

/** Claim one outbox row, send it, record the outcome. Safe to call twice for the same row: only one caller wins the claim. */
async function deliver(id: string) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  const claim = await dbx.from("email_outbox").update({ status: "SENDING", claimed_at: now.toISOString() }).eq("id", id).or(`status.eq.PENDING,and(status.eq.SENDING,claimed_at.lt.${staleBefore})`).select("*");
  const row = claim.data?.[0];
  if (!row) return;
  const attempts = (row.attempts as number) + 1;
  try {
    let attachment: { filename: string; contentType: string; bytes: Uint8Array } | null = null;
    if (row.attachment_bucket && row.attachment_path) {
      const dl = await db.storage.from(row.attachment_bucket as string).download(row.attachment_path as string);
      if (dl.error || !dl.data) throw new Error("Attachment not available");
      attachment = { filename: (row.attachment_name as string) ?? "attachment.pdf", contentType: "application/pdf", bytes: new Uint8Array(await dl.data.arrayBuffer()) };
    }
    const sender = env("GMAIL_SENDER");
    const mime = buildMime({ fromEmail: sender, fromName: brand(), to: row.to_email as string, cc: (row.cc_email as string | null) ?? null, replyTo: env("MAIL_REPLY_TO") || null, subject: row.subject as string, text: row.text_body as string, html: row.html_body as string, messageId: `${id}@${sender.split("@")[1]}`, attachment });
    const providerId = await sendMessage(mime, [row.to_email as string, ...(row.cc_email ? [row.cc_email as string] : [])]);
    await dbx.from("email_outbox").update({ status: "SENT", attempts, sent_at: new Date().toISOString(), provider_message_id: providerId, last_error: null }).eq("id", id);
    if (row.notification_id) await dbx.from("notifications").update({ email_status: "SENT" }).eq("id", row.notification_id);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "send failed").slice(0, 300);
    const dead = attempts >= MAX_ATTEMPTS;
    const next = new Date(Date.now() + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] ?? 720) * 60_000).toISOString();
    await dbx.from("email_outbox").update({ status: dead ? "DEAD" : "PENDING", attempts, last_error: msg, next_attempt_at: next }).eq("id", id);
    if (row.notification_id) await dbx.from("notifications").update({ email_status: dead ? "FAILED" : "QUEUED" }).eq("id", row.notification_id);
    log("mail_send_failed", { id, attempts, dead, error: msg });
  }
}

/** Retries anything due. Called after each send and by /api/public/mail/process. */
export async function processOutbox(limit = 10) {
  if (!mailConfigured()) return { configured: false as const, processed: 0 };
  const nowIso = new Date().toISOString();
  const { data } = await dbx.from("email_outbox").select("id").in("status", ["PENDING", "SENDING"]).lte("next_attempt_at", nowIso).order("next_attempt_at").limit(limit);
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  for (const id of ids) await deliver(id);
  return { configured: true as const, processed: ids.length };
}
