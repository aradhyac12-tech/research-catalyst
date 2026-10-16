import { createFileRoute } from "@tanstack/react-router";

// Safety net: publishes papers that were approved but are still waiting in production (for example if publication failed once).
// Vercel Cron calls it with `Authorization: Bearer <CRON_SECRET>`. Returns counts only.
async function authorised(request: Request) {
  const secrets = [process.env["CRON_SECRET"], process.env["MAIL_CRON_SECRET"]].filter((s): s is string => Boolean(s));
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!secrets.length || !token) return false;
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const d = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return secrets.some((s) => timingSafeEqual(d(token), d(s)));
}

const run = async ({ request }: { request: Request }) => {
  if (!(await authorised(request))) return new Response("Unauthorized", { status: 401 });
  const { publishWaiting, retryAuthorCertificates, retryReviewerCertificates } = await import("@/lib/server/pipeline.server");
  const origin = new URL(request.url).origin;
  // Zenodo: resume due retries and finish publication for papers whose DOI is registered. No-op unless ZENODO_ENVIRONMENT is set.
  const zenodo = await (await import("@/lib/server/zenodo.server")).sweepZenodo(origin).catch(() => ({ due: 0, registered: 0, failed: 0, finished: 0 }));
  const r = await publishWaiting(origin);
  const certs = await retryAuthorCertificates(origin).catch(() => ({ papers: 0, issued: 0, failed: 0 }));
  const reviewerCerts = await retryReviewerCertificates(origin).catch(() => ({ checked: 0, issued: 0 }));
  return new Response(JSON.stringify({ ...r, zenodo, author_certificates: certs, reviewer_certificates: reviewerCerts }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const Route = createFileRoute("/api/public/publish/process")({ server: { handlers: { GET: run, POST: run } } });
