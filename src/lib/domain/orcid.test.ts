import { describe, expect, it } from "vitest";
import { normalizeOrcid, orcidChecksumOk, signState, verifyState } from "./orcid";
import { looksLikeAiAuthor, PAPERLY_ID_RE } from "./scholarly";

describe("ORCID checksum", () => {
  it("accepts published example iDs", () => {
    expect(orcidChecksumOk("0000-0002-1825-0097")).toBe(true);
    expect(orcidChecksumOk("0000-0001-5109-3700")).toBe(true);
    expect(orcidChecksumOk("0000-0002-1694-233X")).toBe(true);
  });
  it("rejects wrong checksum and bad formats", () => {
    expect(orcidChecksumOk("0000-0002-1825-0098")).toBe(false);
    expect(orcidChecksumOk("0000-0002-1825-009")).toBe(false);
    expect(orcidChecksumOk("not-an-orcid")).toBe(false);
  });
  it("normalizes ORCID URLs but not invalid ids", () => {
    expect(normalizeOrcid("https://orcid.org/0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normalizeOrcid("0000-0002-1825-0098")).toBeNull();
  });
});

describe("ORCID OAuth state", () => {
  it("round-trips, and rejects tampering, wrong secret and expiry", async () => {
    const s = await signState({ uid: "u1", exp: Date.now() + 60_000, n: "x" }, "secret");
    expect((await verifyState(s, "secret"))?.uid).toBe("u1");
    expect(await verifyState(s, "other")).toBeNull();
    expect(await verifyState(s.replace(/^./, "A"), "secret")).toBeNull();
    const old = await signState({ uid: "u1", exp: Date.now() - 1, n: "x" }, "secret");
    expect(await verifyState(old, "secret")).toBeNull();
  });
});

describe("scholarly identifiers", () => {
  it("matches PLY-YYYY-XXXXXX only", () => {
    expect(PAPERLY_ID_RE.test("PLY-2026-000001")).toBe(true);
    expect(PAPERLY_ID_RE.test("PLY-2026-1")).toBe(false);
    expect(PAPERLY_ID_RE.test("RP-2026-000001")).toBe(false);
  });
  it("flags AI systems entered as authors", () => {
    expect(looksLikeAiAuthor("ChatGPT")).toBe(true);
    expect(looksLikeAiAuthor("Claude")).toBe(true);
    expect(looksLikeAiAuthor("Priya Sharma")).toBe(false);
  });
});
