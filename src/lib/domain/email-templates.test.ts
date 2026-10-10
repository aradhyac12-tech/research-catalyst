import { describe, expect, it } from "vitest";
import { renderCertificateEmail, renderEmail, shouldEmail } from "./email-templates";

describe("shouldEmail", () => {
  it("e-mails author-facing events", () => {
    for (const k of ["submission_received", "decision_accepted", "decision_rejected", "decision_revision_required", "tracked_change_proposed", "published", "status_update", "payment_paid", "notice", "revision_received", "submission_withdrawn"]) expect(shouldEmail(k)).toBe(true);
  });
  it("keeps internal and separately-sent kinds out", () => {
    for (const k of ["payment_review", "certificate_issued", "review_submitted", "TRACKED_CHANGE_DECIDED", "something_new"]) expect(shouldEmail(k)).toBe(false);
  });
});

describe("renderEmail", () => {
  const base = { kind: "decision_accepted", title: "Editorial decision", body: "Approved.\nMake minor edits.", link: "/my-research/abc", siteUrl: "https://site.example/", recipientName: "Dr Rao" };
  it("builds an absolute link and a friendly subject", () => {
    const r = renderEmail(base);
    expect(r.subject).toBe("[Paperly] Your research paper has been approved");
    expect(r.text).toContain("https://site.example/my-research/abc");
    expect(r.html).toContain('href="https://site.example/my-research/abc"');
    expect(r.text).toContain("Hello Dr Rao,");
  });
  it("escapes HTML in names and bodies", () => {
    const r = renderEmail({ ...base, body: "<script>alert(1)</script>", recipientName: '"><img src=x>' });
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<img");
  });
  it("omits the button when there is no link or site url", () => {
    expect(renderEmail({ ...base, link: null }).html).not.toContain("<a href");
    expect(renderEmail({ ...base, siteUrl: "" }).html).not.toContain("<a href");
  });
  it("uses the notification title for unknown payment kinds", () => expect(renderEmail({ ...base, kind: "payment_paid", title: "Payment received" }).subject).toBe("[Paperly] Payment received"));
});

describe("renderCertificateEmail", () => {
  it("names the certificate and mentions the attachment", () => {
    const r = renderCertificateEmail({ certificateId: "PLY-C-1", type: "PUBLICATION", paperTitle: "Soil carbon", siteUrl: "https://site.example", verifyUrl: "https://site.example/verify/certificate/PLY-C-1?t=x" });
    expect(r.subject).toBe("[Paperly] Your publication certificate PLY-C-1");
    expect(r.text).toContain("attached");
  });
});
