import { describe, expect, it } from "vitest";
import { Route } from "@/routes/r.$code";
import { REFERRAL_COOKIE, readReferralCookie } from "@/lib/domain/referrals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).options.server.handlers.GET as (a: { params: { code: string }; request: Request }) => Promise<Response>;
const hit = (code: string, url = "https://paperly-publications.com", extra: HeadersInit = {}) => GET({ params: { code }, request: new Request(`${url}/r/${code}`, { headers: extra }) });

describe("GET /r/:code", () => {
  it("redirects to sign-up with no code in the address, and remembers the code privately", async () => {
    const r = await hit("K7XM92QF");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/auth?join=1");
    expect(r.headers.get("location")).not.toContain("K7XM92QF");
    const c = r.headers.get("set-cookie")!;
    expect(c).toContain(`${REFERRAL_COOKIE}=K7XM92QF`);
    expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Lax/); expect(c).toMatch(/Secure/);
    expect(readReferralCookie(c.split(";")[0])).toBe("K7XM92QF");
  });
  it("is case-insensitive and stores the canonical form", async () => {
    expect((await hit("k7xm92qf")).headers.get("set-cookie")).toContain("pp_ref=K7XM92QF");
  });
  it("answers a real-looking but unknown code exactly like any other well-formed code (no validity oracle)", async () => {
    const a = await hit("K7XM92QF"), b = await hit("ZZZZZZZZ");
    expect(b.status).toBe(a.status);
    expect([...b.headers.keys()].sort()).toEqual([...a.headers.keys()].sort());
    expect(b.headers.get("location")).toBe(a.headers.get("location"));
  });
  it("ignores malformed codes: same redirect, no cookie", async () => {
    for (const bad of ["BAD", "K7XM92QO", "../../etc/passwd", "K7XM92QFX", ""]) {
      const r = await hit(bad);
      expect(r.status).toBe(302); expect(r.headers.get("location")).toBe("/auth?join=1"); expect(r.headers.get("set-cookie")).toBeNull();
    }
  });
  it("is never cached, indexed or leaked through the Referer header", async () => {
    const r = await hit("K7XM92QF");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("sets Secure behind an https proxy and omits it on plain local http", async () => {
    expect((await hit("K7XM92QF", "http://internal", { "x-forwarded-proto": "https" })).headers.get("set-cookie")).toMatch(/Secure/);
    expect((await hit("K7XM92QF", "http://localhost:3000")).headers.get("set-cookie")).not.toMatch(/Secure/);
  });
});
