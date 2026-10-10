import { createFileRoute } from "@tanstack/react-router";

// Retries e-mails that failed to send. Call it every few minutes with `Authorization: Bearer <MAIL_CRON_SECRET>`
// (Vercel Cron sends `Bearer <CRON_SECRET>` automatically; either secret works). Returns counts only, never addresses or text.
async function authorised(request: Request) {
  const secrets = [process.env["MAIL_CRON_SECRET"], process.env["CRON_SECRET"]].filter((s): s is string => Boolean(s));
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!secrets.length || !token) return false;
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const d = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return secrets.some((s) => timingSafeEqual(d(token), d(s)));
}

const run = async ({ request }: { request: Request }) => {
  if (!(await authorised(request))) return new Response("Unauthorized", { status: 401 });
  const { processOutbox } = await import("@/lib/server/mail.server");
  const r = await processOutbox(25);
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const Route = createFileRoute("/api/public/mail/process")({ server: { handlers: { GET: run, POST: run } } });
