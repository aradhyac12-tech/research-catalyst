// One place that decides what an error means, what a visitor may be told, and what gets logged.
// Visitors only ever see the fixed text below plus a reference ID. Raw messages and stacks go to server logs.

export type ErrorCode =
  | "CONFIG_MISSING" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION"
  | "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "INTERNAL";

export interface ClassifiedError { code: ErrorCode; status: number; title: string; message: string; retryable: boolean }

const TEXT: Record<ErrorCode, Omit<ClassifiedError, "code">> = {
  CONFIG_MISSING: { status: 503, title: "This site is not fully set up yet", message: "A required setting is missing on the server. If you run this site, open /api/public/health to see which one.", retryable: false },
  UNAUTHENTICATED: { status: 401, title: "Please sign in", message: "Your session has ended or you are not signed in.", retryable: false },
  FORBIDDEN: { status: 403, title: "You do not have access", message: "Your account is not allowed to do this.", retryable: false },
  NOT_FOUND: { status: 404, title: "Not found", message: "We could not find what you asked for.", retryable: false },
  VALIDATION: { status: 422, title: "Check the details", message: "Some of the information sent was not valid.", retryable: false },
  RATE_LIMITED: { status: 429, title: "Too many requests", message: "Please wait a moment and try again.", retryable: true },
  UPSTREAM_UNAVAILABLE: { status: 503, title: "A service is unavailable", message: "We could not reach a service this page needs. Try again in a moment.", retryable: true },
  INTERNAL: { status: 500, title: "This page didn't load", message: "Something went wrong on our end. You can try again or head back home.", retryable: true },
};

export function errorText(code: ErrorCode): ClassifiedError { return { code, ...TEXT[code] }; }

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e) ?? String(e); } catch { return String(e); }
}

export function classifyError(e: unknown): ClassifiedError {
  const m = messageOf(e);
  const name = e instanceof Error ? e.name : "";
  if (/missing .*environment variable|environment variable.*(missing|not set)/i.test(m)) return errorText("CONFIG_MISSING");
  if (/^forbidden|insufficient (role|permission)|not allowed/i.test(m)) return errorText("FORBIDDEN");
  if (/unauthori[sz]ed|not signed in|jwt (expired|invalid)|invalid (jwt|token)|session (expired|missing)/i.test(m)) return errorText("UNAUTHENTICATED");
  if (/^not found$|not found/i.test(m) && !/route/i.test(m)) return errorText("NOT_FOUND");
  if (name === "ZodError" || /invalid input|expected (string|number|object)/i.test(m)) return errorText("VALIDATION");
  if (/rate limit|too many requests/i.test(m)) return errorText("RATE_LIMITED");
  if (/fetch failed|failed to fetch|econnrefused|enotfound|etimedout|timed? ?out|network|socket hang up|bad gateway|service unavailable/i.test(m)) return errorText("UPSTREAM_UNAVAILABLE");
  return errorText("INTERNAL");
}

/** Short reference a visitor can quote to the site owner, e.g. ERR-7K3Q9ZD2. Not secret, not guessable-meaningful. */
export function newErrorId(): string {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[(bytes[i % 5]! + i * 7) % 32];
  return `ERR-${out}`;
}

/** What is safe and useful to write to server logs. Never includes request bodies or headers. */
export function logShape(id: string, e: unknown, extra: Record<string, unknown> = {}) {
  const c = classifyError(e);
  const err = e instanceof Error ? e : new Error(messageOf(e));
  return { ts: new Date().toISOString(), event: "error", id, code: c.code, status: c.status, name: err.name, message: err.message.slice(0, 500), stack: (err.stack ?? "").split("\n").slice(0, 8).join("\n"), ...extra };
}

export function sanitizeClientReport(raw: unknown): { id: string; code: string; message: string; path: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : "");
  const id = clip(r["id"], 20);
  if (!/^ERR-[0-9A-Z]{8}$/.test(id)) return null;
  const path = clip(r["path"], 200).split("?")[0] ?? "";
  return { id, code: clip(r["code"], 30), message: clip(r["message"], 300), path };
}
