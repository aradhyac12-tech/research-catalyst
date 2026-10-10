import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_BOOTSTRAP_TOKEN_LENGTH = 32;

export type BootstrapOutcome =
  | { ok: true }
  | { ok: false; reason: "NOT_CONFIGURED" | "BAD_TOKEN" | "EMAIL_MISMATCH" | "ALREADY_BOOTSTRAPPED" };

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time comparison of the supplied token with the deployment secret. */
export function tokenMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

export interface BootstrapDeps {
  expectedToken: string | undefined;
  allowedEmail: string | undefined;
  callerEmail: string | null;
  /** Calls the advisory-locked, service_role-only database function. */
  claim: () => Promise<boolean>;
}

/**
 * One-time administrator bootstrap. Pure so it can be tested without a network:
 * the token gate runs first, the database function is the race-free final authority.
 */
export async function attemptBootstrap(provided: string, d: BootstrapDeps): Promise<BootstrapOutcome> {
  if (!d.expectedToken || d.expectedToken.length < MIN_BOOTSTRAP_TOKEN_LENGTH) return { ok: false, reason: "NOT_CONFIGURED" };
  if (!tokenMatches(provided, d.expectedToken)) return { ok: false, reason: "BAD_TOKEN" };
  if (d.allowedEmail && (d.callerEmail ?? "").toLowerCase() !== d.allowedEmail.trim().toLowerCase()) return { ok: false, reason: "EMAIL_MISMATCH" };
  return (await d.claim()) ? { ok: true } : { ok: false, reason: "ALREADY_BOOTSTRAPPED" };
}
