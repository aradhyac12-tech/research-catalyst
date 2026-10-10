import { renderErrorPage } from "./error-page";
import { classifyError, logShape, newErrorId } from "./errors";

/** Turns any thrown value into a safe HTML response with a reference ID, and writes one structured log line with the real cause. */
export function failureResponse(error: unknown, request?: Request): Response {
  const id = newErrorId();
  const path = request ? new URL(request.url).pathname : undefined;
  console.error(JSON.stringify(logShape(id, error, { path, method: request?.method })));
  const classified = classifyError(error);
  return new Response(renderErrorPage({ id, error: classified }), {
    status: classified.status,
    headers: { "content-type": "text/html; charset=utf-8", "x-error-id": id, "cache-control": "no-store" },
  });
}
