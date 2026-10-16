import { describe, expect, it } from "vitest";
import { buildMetaTags, googleScholarUrl } from "./metadata";
import { outcomeAllowed } from "./review";
import { describeRecord } from "./certificate-pdf";
import { layoutCertificate } from "./certificate-layout";
import { renderCertificateBundleEmail } from "./email-templates";

describe("googleScholarUrl", () => {
  it("is an exact-title Scholar search, safely encoded", () => {
    const u = new URL(googleScholarUrl('Soil "carbon" & climate: a 5-year study'));
    expect(u.origin + u.pathname).toBe("https://scholar.google.com/scholar");
    expect(u.searchParams.get("q")).toBe('"Soil carbon & climate: a 5-year study"');
  });
  it("keeps very long titles bounded", () => expect(new URL(googleScholarUrl("x".repeat(1000))).searchParams.get("q")!.length).toBeLessThanOrEqual(252));
});

describe("reviewer certificate", () => {
  const measure = (t: string, size: number) => t.length * size * 0.5;
  const base = { certificateId: "CERT-2026-000009", type: "PEER_REVIEW" as const, recipientName: "Dr Rao", authorRole: "Peer reviewer", paperTitle: "Peer review PR-AB12CD34EF", articleId: "PR-AB12CD34EF", doi: null, publicationDate: null, issuedAt: "2026-10-11T10:00:00Z", verificationUrl: "https://site.example/verify/certificate/CERT-2026-000009?t=x" };
  it("is confidential: no DOI line, says the manuscript is not named", () => {
    const texts = layoutCertificate(base, measure).ops.flatMap((o) => (o.kind === "text" ? [o.text] : [])).join(" ");
    expect(texts).not.toContain("DOI");
    expect(texts).toContain("not named");
    expect(texts).toContain("PR-AB12CD34EF");
  });
});

describe("certificate e-mail Scholar line", () => {
  it("adds a clearly-labelled search link, and nothing when no link is given", () => {
    const certs = [{ certificateId: "C1", recipientName: "A" }];
    expect(renderCertificateBundleEmail({ paperTitle: "T", certificates: certs, siteUrl: "https://s.example", scholarUrl: "https://scholar.google.com/scholar?q=%22T%22" }).text).toContain("Google Scholar");
    expect(renderCertificateBundleEmail({ paperTitle: "T", certificates: certs, siteUrl: "https://s.example" }).text).not.toContain("Scholar");
  });
});

describe("publication certificate: review status and Google Scholar lines", () => {
  const measure = (t: string, size: number) => t.length * size * 0.5;
  const pub = { certificateId: "CERT-2026-000010", type: "PUBLICATION" as const, recipientName: "A Author", authorRole: "Author", paperTitle: "Soil carbon & climate", articleId: "PLY-2026-000010", doi: null, publicationDate: "2026-10-11T00:00:00Z", issuedAt: "2026-10-11T10:00:00Z", verificationUrl: "https://site.example/verify/certificate/CERT-2026-000010?t=x" };
  const printed = (d: Parameters<typeof layoutCertificate>[0]) => layoutCertificate(d, measure).ops.flatMap((o) => (o.kind === "text" ? [o.text] : [])).join(" | ");
  it("prints the recorded review status and a Scholar search link, never an indexing claim", () => {
    const d = { ...pub, recordType: "Journal article", reviewStatement: "Peer reviewed (completed reviews recorded)" };
    const l = layoutCertificate(d, measure);
    expect(printed(d)).toContain("Peer reviewed (completed reviews recorded)");
    expect(printed(d)).toContain("Google Scholar");
    expect(printed(d)).not.toMatch(/indexed in/i);
    expect(l.links).toHaveLength(1);
    expect(l.links[0]!.url).toBe(googleScholarUrl("Soil carbon & climate"));
  });
  it("omits the review line when no record facts are supplied, but still links Scholar", () => {
    expect(printed(pub)).not.toContain("Peer review");
    expect(layoutCertificate(pub, measure).links).toHaveLength(1);
  });
  it("adds no Scholar link to submission or reviewer certificates", () => {
    for (const type of ["SUBMISSION", "PEER_REVIEW", "AUTHOR_RECORD"] as const) {
      const d = { ...pub, type, reviewStatement: "Peer reviewed (completed reviews recorded)" };
      expect(layoutCertificate(d, measure).links).toHaveLength(0);
      expect(printed(d)).not.toContain("Google Scholar");
    }
  });
  it("a submission certificate says the work is submitted to peer review, never that it was reviewed", () => {
    const d = { ...pub, type: "SUBMISSION" as const, publicationDate: null, reviewStatement: "Peer reviewed (completed reviews recorded)" };
    expect(printed(d)).toContain("Submitted to the Paperly peer review process");
    expect(printed(d)).toContain("not yet decided");
    expect(printed(d)).not.toContain("Peer reviewed (completed");
  });
});

describe("every record type goes through peer review", () => {
  it("cannot be accepted without a completed review, whatever its type", () => {
    for (const publicationType of ["REPOSITORY_RECORD", "PREPRINT", "JOURNAL_ARTICLE"]) {
      expect(outcomeAllowed({ status: "EDITORIAL_DECISION", publicationType, outcome: "ACCEPT", completedReviews: 0 })).not.toBeNull();
      expect(outcomeAllowed({ status: "REVIEW_REQUIRED", publicationType, outcome: "ACCEPT", completedReviews: 0 })).not.toBeNull();
      expect(outcomeAllowed({ status: "EDITORIAL_DECISION", publicationType, outcome: "ACCEPT", completedReviews: 1 })).toBeNull();
      expect(outcomeAllowed({ status: "REVIEW_REQUIRED", publicationType, outcome: "REJECT", completedReviews: 0 })).toBeNull();
    }
  });
  it("the certificate wording says peer reviewed only when completed reviews are recorded", () => {
    expect(describeRecord("REPOSITORY_RECORD", true, "PUBLISHED").reviewStatement).toContain("Peer reviewed");
    expect(describeRecord("REPOSITORY_RECORD", false, "PUBLISHED").reviewStatement).toContain("Not peer reviewed");
    expect(describeRecord("JOURNAL_ARTICLE", false, "PUBLISHED").reviewStatement).toBe("Peer review not recorded");
  });
});

describe("Google Scholar metadata", () => {
  const paper = { title: "T", authors: ["A"], year: 2026, publicId: "PLY-2026-000010", doi: null, url: "https://s.example/article/PLY-2026-000010", version: "1.0", publicationType: "JOURNAL_ARTICLE" as const, publishedDate: "2026-10-11", abstract: "a", keywords: [], language: "en", status: "PUBLISHED", license: null, field: "x", authorsDetailed: [{ name: "A", affiliations: [] }] };
  it("names the full-text PDF on the same host only when there is one", () => {
    const withPdf = buildMetaTags({ ...paper, pdfUrl: "https://s.example/article/PLY-2026-000010/pdf" });
    expect(withPdf.find((t) => t["name"] === "citation_pdf_url")?.["content"]).toBe("https://s.example/article/PLY-2026-000010/pdf");
    expect(buildMetaTags({ ...paper, pdfUrl: null }).some((t) => t["name"] === "citation_pdf_url")).toBe(false);
    expect(withPdf.some((t) => t["name"] === "citation_title")).toBe(true);
  });
});
