import { describe, expect, it } from "vitest";
import { buildMime, isEmail, toBase64Url } from "./gmail-mime";

const base = { fromEmail: "journal@gmail.com", fromName: "Paperly", to: "author@example.org", subject: "Hello", text: "plain", html: "<p>html</p>", date: new Date("2026-10-10T10:00:00Z") };

describe("buildMime", () => {
  it("builds a text and html message", () => {
    const m = buildMime(base);
    expect(m).toContain("From: Paperly <journal@gmail.com>");
    expect(m).toContain("To: author@example.org");
    expect(m).toContain("multipart/alternative");
    expect(m).toContain("text/plain");
    expect(m).toContain("text/html");
  });
  it("encodes non-ASCII subjects", () => {
    expect(buildMime({ ...base, subject: "Décision — résumé" })).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });
  it("strips line breaks from header values (no header injection)", () => {
    const m = buildMime({ ...base, subject: "Hi\r\nBcc: evil@example.org" });
    expect(m.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
  it("rejects invalid addresses", () => {
    expect(() => buildMime({ ...base, to: "a@b.org\r\nBcc: x@y.org" })).toThrow();
    expect(() => buildMime({ ...base, cc: "nope" })).toThrow();
  });
  it("adds cc and an attachment", () => {
    const m = buildMime({ ...base, cc: "corr@example.org", attachment: { filename: "cert.pdf", contentType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) } });
    expect(m).toContain("Cc: corr@example.org");
    expect(m).toContain("multipart/mixed");
    expect(m).toContain('filename="cert.pdf"');
    expect(m).toContain("JVBERg=="); // "%PDF" in base64
  });
});

describe("helpers", () => {
  it("base64url has no padding or unsafe characters", () => expect(toBase64Url("???>>>")).toMatch(/^[A-Za-z0-9_-]+$/));
  it("isEmail accepts normal and rejects odd addresses", () => {
    expect(isEmail("a.b+c@sub.example.org")).toBe(true);
    for (const bad of ["", "a@b", "a b@c.org", "<a@b.org>", "a@b.org,c@d.org"]) expect(isEmail(bad)).toBe(false);
  });
});
