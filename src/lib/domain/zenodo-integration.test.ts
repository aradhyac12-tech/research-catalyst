import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { layoutCertificate } from "./certificate-layout";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const measure = (t: string, size: number) => t.length * size * 0.5;
const cert = { certificateId: "CERT-2026-000001", type: "PUBLICATION" as const, recipientName: "Ada Lovelace", authorRole: "Author", paperTitle: "A study of cats", articleId: "PLY-2026-000001", publicationDate: "2026-10-12", issuedAt: "2026-10-12", verificationUrl: "https://p.example/verify/certificate/CERT-2026-000001" };
const texts = (l: ReturnType<typeof layoutCertificate>) => l.ops.filter((o) => o.kind === "text").map((o) => (o as { text: string }).text);

describe("certificate DOI", () => {
  it("prints the confirmed DOI as a clickable doi.org link with its own QR, separate from the certificate ID", () => {
    const l = layoutCertificate({ ...cert, doi: "10.5281/zenodo.9" }, measure as never);
    expect(texts(l).some((t) => t.includes("https://doi.org/10.5281/zenodo.9"))).toBe(true);
    expect(l.links.filter((x) => x.url === "https://doi.org/10.5281/zenodo.9").length).toBeGreaterThan(0);
    expect(l.ops.filter((o) => o.kind === "qr")).toHaveLength(2); // verification QR + DOI QR
    expect(texts(l)).toContain("CERT-2026-000001");
  });
  it("makes no DOI claim when there is no confirmed DOI, and the QR/verification features stay", () => {
    const l = layoutCertificate({ ...cert, doi: null }, measure as never);
    expect(texts(l).join(" ")).toContain("DOI: not registered at issue"); expect(l.ops.filter((o) => o.kind === "qr")).toHaveLength(1);
  });
  it("labels a Sandbox DOI as a test DOI", () => {
    expect(texts(layoutCertificate({ ...cert, doi: "10.5072/zenodo.9", doiSandbox: true }, measure as never)).join(" ")).toContain("Sandbox test DOI");
  });
  it("never claims indexing, accreditation or an impact factor", () => {
    const doiLines = texts(layoutCertificate({ ...cert, doi: "10.5281/zenodo.9" }, measure as never)).filter((t) => /doi/i.test(t)).join(" ").toLowerCase();
    expect(doiLines).not.toMatch(/impact factor|accredit|scopus|web of science|indexed/); // the DOI lines make no such claim (the standing disclaimer elsewhere only disclaims them)
  });
});

describe("wiring (static checks of the integration points)", () => {
  const server = read("src/lib/server/zenodo.server.ts");
  const pipe = read("src/lib/server/pipeline.server.ts");
  it("secrets are read only in server code", () => {
    for (const f of ["src/lib/zenodo.functions.ts", "src/components/zenodo-admin.tsx", "src/components/doi-link.tsx", "src/routes/article.$paperlyId.tsx"]) expect(read(f)).not.toMatch(/env(\.|\[["'])ZENODO/); // (zenodo.functions.ts only reads PUBLIC_SITE_URL for the site address)
    expect(read("src/lib/zenodo.functions.ts")).toMatch(/import\("@\/lib\/server\/zenodo\.server"\)/);
  });
  it("the token is never written to the database, audit trail or logs", () => {
    expect(server).not.toMatch(/token:\s*cfg\.token[^,}]*\)?\s*\}\s*\)\s*;?\s*\n.*audit/);
    expect(server).not.toMatch(/log\([^)]*token/i); expect(server).not.toMatch(/audit\([^)]*cfg\.token/);
    expect(read("drizzle/migrations/0035_zenodo_doi_registration.sql")).not.toMatch(/token\s+text/i);
  });
  it("every server operation checks the role on the server", () => {
    for (const fn of ["approveAndRegister", "retryRegistration", "zenodoStatus", "testConnection", "setProductionEnabled", "listRegistrations", "updatePublishedMetadata"]) {
      const m = new RegExp(`export async function ${fn}\\b[\\s\\S]*?\\n}\\n`).exec(server); expect(m).not.toBeNull(); expect(m![0]).toMatch(/requireZenodoRole\(/);
    }
  });
  it("publishPaper only reads a registered DOI when Zenodo is enabled and never creates one", () => {
    const i = pipe.indexOf("export async function publishPaper"); const body = pipe.slice(i, i + 6000);
    expect(body).toMatch(/if \(zenodoEnabled\(\)\)/); expect(body).toMatch(/workflow_status !== "registered"/); expect(body).not.toMatch(/createDeposit|zenodo\.org/);
    expect(body).toMatch(/transition\(paperId, "PUBLISHED"/);
  });
  it("auto-publication waits for approval and a registered DOI when Zenodo is enabled", () => {
    const i = pipe.indexOf("export async function autoPublish"); expect(pipe.slice(i, i + 900)).toMatch(/zenodoEnabled\(\) && !\(await zenodoRegistered/);
  });
  it("migration enforces one record per paper, a complete 'registered' row and an immutable registered identity", () => {
    const sql = read("drizzle/migrations/0035_zenodo_doi_registration.sql");
    expect(sql).toMatch(/doi_records_registered_complete/); expect(sql).toMatch(/doi_records_zenodo_deposit_uniq/); expect(sql).toMatch(/doi_records_zenodo_immutable/);
    expect(sql).toMatch(/workflow_status in \('not_started','pending','uploading','publishing','registered','failed'\)/);
    expect(read("drizzle/migrations/0000_paperly_core_schema.sql")).toMatch(/paper_id uuid not null unique references public\.papers/);
    expect(sql).toMatch(/revoke execute on function public\.zenodo_claim_registration/);
  });
  it("the journal lists the new migration", () => { expect(read("drizzle/migrations/meta/_journal.json")).toContain("0035_zenodo_doi_registration"); });
});
