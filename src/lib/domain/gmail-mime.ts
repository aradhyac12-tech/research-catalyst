// Builds the raw RFC 2822 message the Gmail API expects. Pure and tested (gmail-mime.test.ts); no network, no secrets.
const EMAIL = /^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]+$/;
export const isEmail = (s: string) => s.length <= 254 && EMAIL.test(s);

/** Header values never carry line breaks: that is how header injection works. */
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const b64 = (b: Uint8Array | string) => Buffer.from(b as never).toString("base64");
const wrap = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
/** RFC 2047 encoded-word so subjects and names with accents or non-Latin text survive. */
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export interface MimeInput {
  fromEmail: string; fromName?: string; to: string; cc?: string | null; replyTo?: string | null;
  subject: string; text: string; html: string; messageId?: string; date?: Date;
  attachment?: { filename: string; contentType: string; bytes: Uint8Array } | null;
}

export function buildMime(i: MimeInput): string {
  for (const [label, v] of [["from", i.fromEmail], ["to", i.to]] as const) if (!isEmail(v)) throw new Error(`Invalid ${label} address`);
  if (i.cc && !isEmail(i.cc)) throw new Error("Invalid cc address");
  if (i.replyTo && !isEmail(i.replyTo)) throw new Error("Invalid reply-to address");
  const alt = `alt_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const mix = `mix_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const from = i.fromName ? `${word(clean(i.fromName))} <${i.fromEmail}>` : i.fromEmail;
  const head = [
    `From: ${from}`, `To: ${i.to}`, ...(i.cc ? [`Cc: ${i.cc}`] : []), ...(i.replyTo ? [`Reply-To: ${i.replyTo}`] : []),
    `Subject: ${word(clean(i.subject))}`, `Date: ${(i.date ?? new Date()).toUTCString()}`,
    ...(i.messageId ? [`Message-ID: <${clean(i.messageId)}>`] : []), "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
  ];
  const part = (type: string, body: string) => [`Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap(b64(body))].join("\r\n");
  const altBody = [`--${alt}`, part("text/plain", i.text), `--${alt}`, part("text/html", i.html), `--${alt}--`].join("\r\n");
  if (!i.attachment) return [...head, `Content-Type: multipart/alternative; boundary="${alt}"`, "", altBody].join("\r\n");
  const name = clean(i.attachment.filename).replace(/"/g, "");
  return [
    ...head, `Content-Type: multipart/mixed; boundary="${mix}"`, "",
    `--${mix}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "", altBody,
    `--${mix}`, `Content-Type: ${i.attachment.contentType}; name="${name}"`, "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${name}"`, "", wrap(b64(i.attachment.bytes)), `--${mix}--`, "",
  ].join("\r\n");
}

/** Gmail wants the whole message base64url-encoded. */
export const toBase64Url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
