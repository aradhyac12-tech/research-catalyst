import { describe, expect, it } from "vitest";
import { attemptBootstrap, tokenMatches } from "./bootstrap";

const TOKEN = "t".repeat(40);

/** In-memory stand-in for the advisory-locked SQL function: serialised, first caller wins, refuses once an admin exists. */
function fakeDb(existingAdmin = false) {
  let hasAdmin = existingAdmin;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    claim: () => {
      const run = chain.then(async () => { await new Promise((r) => setTimeout(r, Math.random() * 5)); if (hasAdmin) return false; hasAdmin = true; return true; });
      chain = run.catch(() => undefined);
      return run;
    },
    get hasAdmin() { return hasAdmin; },
  };
}
const deps = (db: { claim: () => Promise<boolean> }, over: Record<string, unknown> = {}) => ({ expectedToken: TOKEN, allowedEmail: undefined, callerEmail: "owner@example.com", claim: db.claim, ...over });

describe("admin bootstrap", () => {
  it("grants the first admin with the correct token", async () => {
    const db = fakeDb();
    expect(await attemptBootstrap(TOKEN, deps(db))).toEqual({ ok: true });
    expect(db.hasAdmin).toBe(true);
  });
  it("refuses when the token is not configured or too short", async () => {
    const db = fakeDb();
    expect(await attemptBootstrap(TOKEN, deps(db, { expectedToken: undefined }))).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(await attemptBootstrap("short", deps(db, { expectedToken: "short" }))).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(db.hasAdmin).toBe(false);
  });
  it("ordinary signup (no/wrong token) never gains privileges", async () => {
    const db = fakeDb();
    expect(await attemptBootstrap("", deps(db))).toEqual({ ok: false, reason: "BAD_TOKEN" });
    expect(await attemptBootstrap("x".repeat(40), deps(db))).toEqual({ ok: false, reason: "BAD_TOKEN" });
    expect(db.hasAdmin).toBe(false);
  });
  it("enforces the optional owner e-mail", async () => {
    const db = fakeDb();
    expect(await attemptBootstrap(TOKEN, deps(db, { allowedEmail: "owner@example.com", callerEmail: "evil@example.com" }))).toEqual({ ok: false, reason: "EMAIL_MISMATCH" });
    expect(await attemptBootstrap(TOKEN, deps(db, { allowedEmail: "Owner@Example.com", callerEmail: "owner@example.com" }))).toEqual({ ok: true });
  });
  it("repeated attempts: second claim is refused even with a valid token", async () => {
    const db = fakeDb();
    expect((await attemptBootstrap(TOKEN, deps(db))).ok).toBe(true);
    expect(await attemptBootstrap(TOKEN, deps(db))).toEqual({ ok: false, reason: "ALREADY_BOOTSTRAPPED" });
  });
  it("existing administrators are preserved: no claim succeeds", async () => {
    const db = fakeDb(true);
    expect(await attemptBootstrap(TOKEN, deps(db))).toEqual({ ok: false, reason: "ALREADY_BOOTSTRAPPED" });
  });
  it("concurrent claims: exactly one winner", async () => {
    const db = fakeDb();
    const results = await Promise.all(Array.from({ length: 25 }, () => attemptBootstrap(TOKEN, deps(db))));
    expect(results.filter((r) => r.ok).length).toBe(1);
  });
  it("token compare is exact", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN + "x", TOKEN)).toBe(false);
  });
});
