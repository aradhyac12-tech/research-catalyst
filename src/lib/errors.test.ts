import { describe, expect, it } from "vitest";
import { classifyError, logShape, newErrorId, sanitizeClientReport } from "./errors";

describe("classifyError", () => {
  it("recognises the missing-configuration crash behind a blank site", () => {
    expect(classifyError(new Error("Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Copy them from .env.example.")).code).toBe("CONFIG_MISSING");
  });
  it("maps access errors", () => {
    expect(classifyError(new Error("Forbidden: insufficient role")).code).toBe("FORBIDDEN");
    expect(classifyError(new Error("JWT expired")).code).toBe("UNAUTHENTICATED");
    expect(classifyError(new Error("Not found")).code).toBe("NOT_FOUND");
  });
  it("maps network failures to a retryable upstream error", () => {
    const c = classifyError(new TypeError("fetch failed"));
    expect(c.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(c.retryable).toBe(true);
  });
  it("falls back to INTERNAL and never echoes the raw message to visitors", () => {
    const c = classifyError(new Error("relation \"secret_table\" does not exist at 10.0.0.5"));
    expect(c.code).toBe("INTERNAL");
    expect(c.message).not.toContain("secret_table");
    expect(c.message).not.toContain("10.0.0.5");
  });
  it("handles non-Error throws", () => {
    expect(classifyError("boom").code).toBe("INTERNAL");
    expect(classifyError(undefined).code).toBe("INTERNAL");
  });
});

describe("error ids and logs", () => {
  it("makes well-formed, mostly distinct references", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newErrorId()));
    for (const id of ids) expect(/^ERR-[0-9A-Z]{8}$/.test(id)).toBe(true);
    expect(ids.size > 190).toBe(true);
  });
  it("log lines carry the cause and the id but a bounded stack", () => {
    const l = logShape("ERR-AAAAAAAA", new Error("db down"), { path: "/x" });
    expect(l.id).toBe("ERR-AAAAAAAA");
    expect(l.message).toBe("db down");
    expect(l.stack.split("\n").length <= 8).toBe(true);
  });
});

describe("client error reports", () => {
  it("accepts a well-formed report and strips the query string", () => {
    expect(sanitizeClientReport({ id: "ERR-ABCD1234", code: "INTERNAL", message: "x", path: "/explore?q=secret" })?.path).toBe("/explore");
  });
  it("rejects junk, bad ids and non-objects", () => {
    expect(sanitizeClientReport(null)).toBeNull();
    expect(sanitizeClientReport({ id: "nope" })).toBeNull();
    expect(sanitizeClientReport("ERR-ABCD1234")).toBeNull();
  });
  it("clips long messages", () => {
    expect(sanitizeClientReport({ id: "ERR-ABCD1234", code: "A", message: "m".repeat(5000), path: "/" })!.message.length).toBe(300);
  });
});
