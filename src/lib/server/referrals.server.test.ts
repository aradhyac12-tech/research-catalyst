import { beforeEach, describe, expect, it, vi } from "vitest";

// A loose row for the in-memory fake database. `any` is deliberate and confined to this test file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type R = { data: unknown; error: { code?: string; message: string } | null; count?: number };
const T: Record<string, Row[]> = {};
const calls = { from: 0, rpc: 0 };
const audits: Row[] = [];
let failDb = false;
const ADMIN = "admin-1", AUTHOR = "author-1", OTHER = "author-2";

class Q implements PromiseLike<R> {
  private f: Array<(r: Row) => boolean> = []; private op = "select"; private payload: Row | null = null; private lim = Infinity;
  constructor(private t: string) { calls.from++; }
  select() { return this; } order() { return this; } range() { return this; } or() { return this; }
  limit(n: number) { this.lim = n; return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  in(c: string, v: unknown[]) { this.f.push((r) => v.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  maybeSingle() { return this.run(true); } single() { return this.run(true); }
  then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> { return this.run(false).then(ok, no); }
  private async run(single: boolean): Promise<R> {
    if (failDb) throw new Error("db down");
    const rows = (T[this.t] ??= []); const hit = () => rows.filter((r) => this.f.every((fn) => fn(r)));
    if (this.op === "insert") {
      const p = { ...this.payload!, id: this.payload!.id ?? `id-${rows.length + 1}` };
      if (this.t === "referral_user_attributions" && rows.some((r) => r.user_id === p.user_id)) return { data: null, error: { code: "23505", message: "dup" } };
      rows.push(p); return { data: p, error: null };
    }
    if (this.op === "update") { hit().forEach((r) => Object.assign(r, this.payload)); return { data: null, error: null }; }
    if (this.op === "delete") { const h = hit(); T[this.t] = rows.filter((r) => !h.includes(r)); return { data: null, error: null }; }
    const h = hit().slice(0, this.lim);
    return { data: single ? (h[0] ?? null) : h, error: null, count: h.length };
  }
}
const rpcImpl = (name: string, a: Row) => {
  calls.rpc++;
  if (name === "referral_claim_discount") {
    const rows = (T["referral_discount_uses"] ??= []);
    if (rows.some((r) => r.payment_id === a.p_payment_id)) return { data: true, error: null };
    const pays = T["payments"] ?? [];
    const clash = rows.some((u) => u.user_id === a.p_user_id && (() => { const p = pays.find((x) => x.id === u.payment_id); return !!p && ((p.paper_id !== a.p_paper_id && ["PAID", "PROCESSING", "REFUNDED", "PENDING"].includes(p.status)) || (p.paper_id === a.p_paper_id && ["PAID", "PROCESSING", "REFUNDED"].includes(p.status))); })());
    if (clash) return { data: false, error: null };
    rows.push({ payment_id: a.p_payment_id, user_id: a.p_user_id, paper_id: a.p_paper_id, partner_id: a.p_partner_id, link_id: a.p_link_id, amount_minor: a.p_amount });
    return { data: true, error: null };
  }
  if (name !== "referral_set_paper_shares") return { data: T[`__rpc:${name}`] ?? [], error: null };
  const rows = (T["referral_paper_attributions"] ??= []);
  if (rows.some((r) => r.paper_id === a.p_paper_id)) { if (!a.p_overwrite) return { data: false, error: null }; T["referral_paper_attributions"] = rows.filter((r) => r.paper_id !== a.p_paper_id); }
  for (const s of a.p_shares as Row[]) T["referral_paper_attributions"]!.push({ paper_id: a.p_paper_id, partner_id: s.partner_id, link_id: s.link_id, share_percent: s.share_percent, source: a.p_source });
  return { data: true, error: null };
};
vi.mock("@/lib/server/core.server", () => {
  const client = { from: (t: string) => new Q(t), rpc: async (n: string, a: Row) => { if (failDb) throw new Error("db down"); return rpcImpl(n, a); } };
  return {
    db: client, dbx: client,
    audit: async (e: Row) => { audits.push(e); }, log: () => {},
    requirePermission: async (uid: string, p: string) => { if (uid !== ADMIN || p !== "REFERRAL_ADMIN") throw new Error("Forbidden"); },
    certificateSiteUrl: (o?: string) => o || "https://paperly-publications.com",
  };
});
import * as rf from "./referrals.server";

const cookie = (c: string) => `a=1; pp_ref=${c}; b=2`;
const seed = () => {
  for (const k of Object.keys(T)) delete T[k];
  T["referral_partners"] = [{ id: "pA", display_name: "Alpha Secret Name", active: true }, { id: "pB", display_name: "Beta Secret Name", active: true }, { id: "pC", display_name: "Gamma", active: false }];
  T["referral_links"] = [{ id: "lA", partner_id: "pA", code: "AAAAAAAA", active: true }, { id: "lB", partner_id: "pB", code: "BBBBBBBB", active: true }, { id: "lC", partner_id: "pC", code: "CCCCCCCC", active: true }, { id: "lOld", partner_id: "pA", code: "DDDDDDDD", active: false }];
  T["papers"] = [{ id: "paper1", owner_id: AUTHOR }, { id: "paper2", owner_id: AUTHOR }];
  T["referral_user_attributions"] = []; T["referral_paper_attributions"] = [];
  audits.length = 0; calls.from = 0; calls.rpc = 0; failDb = false;
};
beforeEach(seed);

describe("registration referral", () => {
  it("records the partner behind a live link once (first touch wins) and audits ids only", async () => {
    expect(await rf.recordRegistrationReferral(AUTHOR, cookie("AAAAAAAA"))).toBe(true);
    expect(T["referral_user_attributions"]).toEqual([expect.objectContaining({ user_id: AUTHOR, partner_id: "pA", link_id: "lA" })]);
    expect(await rf.recordRegistrationReferral(AUTHOR, cookie("BBBBBBBB"))).toBe(false);
    expect(T["referral_user_attributions"]).toHaveLength(1);
    expect(T["referral_user_attributions"]![0]!.partner_id).toBe("pA");
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toMatch(/Secret|Alpha|display_name/);
  });
  it("ignores missing, malformed, unknown, revoked and paused-partner codes", async () => {
    for (const h of [null, "", "x=1", cookie("nope"), cookie("ZZZZZZZZ"), cookie("DDDDDDDD"), cookie("CCCCCCCC")]) expect(await rf.recordRegistrationReferral(AUTHOR, h)).toBe(false);
    expect(T["referral_user_attributions"]).toHaveLength(0);
  });
  it("never throws, even when the database is down", async () => {
    failDb = true;
    await expect(rf.recordRegistrationReferral(AUTHOR, cookie("AAAAAAAA"))).resolves.toBe(false);
  });
});

describe("submission referral", () => {
  it("credits the link used for the submission at 100%", async () => {
    expect(await rf.recordSubmissionReferral(AUTHOR, "paper1", cookie("AAAAAAAA"))).toBe(true);
    expect(T["referral_paper_attributions"]).toEqual([expect.objectContaining({ partner_id: "pA", share_percent: 100, source: "SUBMISSION_LINK" })]);
  });
  it("falls back to the partner the author registered through", async () => {
    await rf.recordRegistrationReferral(AUTHOR, cookie("BBBBBBBB"));
    expect(await rf.recordSubmissionReferral(AUTHOR, "paper1", null)).toBe(true);
    expect(T["referral_paper_attributions"]).toEqual([expect.objectContaining({ partner_id: "pB", share_percent: 100, source: "REGISTRATION" })]);
  });
  it("splits 50/50 when the submission link and the registration link belong to different partners", async () => {
    await rf.recordRegistrationReferral(AUTHOR, cookie("BBBBBBBB"));
    await rf.recordSubmissionReferral(AUTHOR, "paper1", cookie("AAAAAAAA"));
    const rows = T["referral_paper_attributions"]!;
    expect(rows.map((r) => [r.partner_id, r.share_percent, r.source]).sort()).toEqual([["pA", 50, "JOINT_AUTO"], ["pB", 50, "JOINT_AUTO"]]);
  });
  it("does not double count one partner, and a replay or an admin's split is never overwritten", async () => {
    await rf.recordRegistrationReferral(AUTHOR, cookie("AAAAAAAA"));
    await rf.recordSubmissionReferral(AUTHOR, "paper1", cookie("AAAAAAAA"));
    expect(T["referral_paper_attributions"]).toHaveLength(1);
    await rf.adminSetPaperShares(ADMIN, "paper1", [{ partnerId: "pA", sharePercent: 70 }, { partnerId: "pB", sharePercent: 30 }]);
    expect(await rf.recordSubmissionReferral(AUTHOR, "paper1", cookie("BBBBBBBB"))).toBe(false);
    expect(T["referral_paper_attributions"]!.map((r) => r.share_percent).sort()).toEqual([30, 70]);
  });
  it("does nothing without a referral, for someone else's paper, or when the database is down", async () => {
    expect(await rf.recordSubmissionReferral(AUTHOR, "paper1", null)).toBe(false);
    expect(await rf.recordSubmissionReferral(OTHER, "paper1", cookie("AAAAAAAA"))).toBe(false);
    expect(await rf.recordSubmissionReferral(AUTHOR, "missing", cookie("AAAAAAAA"))).toBe(false);
    expect(T["referral_paper_attributions"]).toHaveLength(0);
    failDb = true;
    await expect(rf.recordSubmissionReferral(AUTHOR, "paper1", cookie("AAAAAAAA"))).resolves.toBe(false);
  });
});

describe("administrator functions are gated on the server", () => {
  const fnNames = Object.keys(rf).filter((k) => k.startsWith("admin"));
  it("covers every admin function", () => expect(fnNames.length).toBeGreaterThanOrEqual(9));
  const args: Record<string, unknown[]> = {
    adminListPartners: [], adminCreatePartner: [{ displayName: "X Y" }], adminUpdatePartner: ["pA", { displayName: "X Y" }],
    adminSetPartnerActive: ["pA", false], adminRotateLink: ["pA"], adminGetPaperReferral: ["paper1"],
    adminSetPaperShares: ["paper1", [{ partnerId: "pA", sharePercent: 100 }]], adminClearPaperShares: ["paper1"], adminRecentAttributions: [],
    adminListReferralUsers: [{ page: 1 }], adminListReferralDiscounts: [1], adminSetUserReferral: [{ subjectId: "u-1", discountMinor: 10000 }],
  };
  for (const name of fnNames) {
    it(`${name}: refuses authors, editors and unknown ids before touching any data`, async () => {
      expect(args[name], `add test arguments for ${name}`).toBeDefined();
      for (const who of [AUTHOR, OTHER, "editor-1", ""]) {
        calls.from = 0; calls.rpc = 0;
        await expect((rf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!(who, ...args[name]!)).rejects.toThrow("Forbidden");
        expect(calls.from + calls.rpc).toBe(0);
      }
      expect(audits).toHaveLength(0);
    });
  }
});

describe("administrator views", () => {
  it("shows the referral source with names and joint percentages to an admin", async () => {
    await rf.recordRegistrationReferral(AUTHOR, cookie("BBBBBBBB"));
    await rf.recordSubmissionReferral(AUTHOR, "paper1", cookie("AAAAAAAA"));
    const v = await rf.adminGetPaperReferral(ADMIN, "paper1");
    expect(v.registeredVia?.partnerName).toBe("Beta Secret Name");
    expect(v.shares.map((s) => `${s.partnerName}:${s.sharePercent}`).sort()).toEqual(["Alpha Secret Name:50", "Beta Secret Name:50"]);
    expect(v.partners.map((p) => p.name)).toContain("Gamma");
    const recent = await rf.adminRecentAttributions(ADMIN);
    expect(recent).toHaveLength(1); expect(recent[0]!.shares).toHaveLength(2);
  });
  it("rejects splits that do not add to 100 before writing anything", async () => {
    await expect(rf.adminSetPaperShares(ADMIN, "paper1", [{ partnerId: "pA", sharePercent: 60 }, { partnerId: "pB", sharePercent: 30 }])).rejects.toThrow(/100%/);
    expect(calls.rpc).toBe(0); expect(audits).toHaveLength(0);
  });
  it("lists partners with a link built from the opaque code only", async () => {
    const list = await rf.adminListPartners(ADMIN, "https://paperly-publications.com");
    const a = list.find((p) => p.id === "pA")!;
    expect(a.link?.url).toBe("https://paperly-publications.com/r/AAAAAAAA");
    const path = new URL(a.link!.url).pathname;
    expect(path).toMatch(/^\/r\/[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(path).not.toMatch(/alpha|secret/i);
    expect(a.link!.url).not.toContain("pA/");
  });
});

describe("registered users and their discount", () => {
  const profiles = () => [
    { id: "u-1", email: "asha@example.com", display_name: "Asha Rao", age: 21, researcher_id: "R-000001", created_at: "2026-10-01T00:00:00Z", details_completed: true },
    { id: "u-2", email: "bob@example.com", display_name: "bob", age: null, researcher_id: "R-000002", created_at: "2026-10-02T00:00:00Z", details_completed: false },
    { id: "s1", email: "s1@example.com", display_name: "Student One", age: 20, researcher_id: "R-000003", created_at: "2026-10-03T00:00:00Z", details_completed: true },
    { id: "s2", email: "s2@example.com", display_name: "Student Two", age: 22, researcher_id: "R-000004", created_at: "2026-10-04T00:00:00Z", details_completed: true },
  ];
  const ORIGIN = "https://paperly-publications.com";
  beforeEach(() => { T["profiles"] = profiles(); });

  it("generates one private link for a user and keeps it when only the discount changes", async () => {
    const a = await rf.adminSetUserReferral(ADMIN, { subjectId: "u-1", discountMinor: 20000 }, ORIGIN);
    expect(a.created).toBe(true); expect(a.url).toMatch(/^https:\/\/paperly-publications\.com\/r\/[A-HJ-KM-NP-Z2-9]{8}$/);
    const b = await rf.adminSetUserReferral(ADMIN, { subjectId: "u-1", discountMinor: 35000 }, ORIGIN);
    expect(b.created).toBe(false); expect(b.url).toBe(a.url);
    const mine = T["referral_partners"]!.filter((p) => p.user_id === "u-1");
    expect(mine).toHaveLength(1);
    const live = T["referral_links"]!.filter((l) => l.partner_id === mine[0]!.id && l.active);
    expect(live).toHaveLength(1); expect(live[0]!.discount_minor).toBe(35000);
    expect(JSON.stringify(audits)).not.toMatch(/Asha|asha@/);
  });
  it("refuses a bad discount or an unknown user without writing", async () => {
    for (const d of [-1, 1.5, 100_000_001]) await expect(rf.adminSetUserReferral(ADMIN, { subjectId: "u-1", discountMinor: d }, ORIGIN)).rejects.toThrow(/discount/i);
    await expect(rf.adminSetUserReferral(ADMIN, { subjectId: "nobody", discountMinor: 100 }, ORIGIN)).rejects.toThrow(/not found/i);
    expect(T["referral_links"]!.filter((l) => l.partner_id !== "pA" && l.partner_id !== "pB" && l.partner_id !== "pC")).toHaveLength(0);
  });
  it("a new link for the same person keeps the discount", async () => {
    await rf.adminSetUserReferral(ADMIN, { subjectId: "u-1", discountMinor: 12345 }, ORIGIN);
    const pid = T["referral_partners"]!.find((p) => p.user_id === "u-1")!.id;
    await rf.adminRotateLink(ADMIN, pid, ORIGIN);
    const live = T["referral_links"]!.filter((l) => l.partner_id === pid && l.active);
    expect(live).toHaveLength(1); expect(live[0]!.discount_minor).toBe(12345);
  });
  it("lists every user, hides blank names, and shows the full discount for each uploader", async () => {
    await rf.adminSetUserReferral(ADMIN, { subjectId: "u-1", discountMinor: 10000 }, ORIGIN);
    const pid = T["referral_partners"]!.find((p) => p.user_id === "u-1")!.id;
    T["__rpc:referral_partner_stats"] = [{ partner_id: pid, registrations: 5, articles: 3, credited: 3 }];
    T["__rpc:referral_partner_uploaders"] = [
      { partner_id: pid, user_id: "s2", papers: 1, first_upload: "2026-10-09T00:00:00Z" },
      { partner_id: pid, user_id: "s1", papers: 2, first_upload: "2026-10-05T00:00:00Z" },
      { partner_id: "pA", user_id: "s1", papers: 1, first_upload: "2026-10-05T00:00:00Z" },
    ];
    const page = await rf.adminListReferralUsers(ADMIN, { page: 1 }, ORIGIN);
    expect(page.total).toBe(4); expect(page.rows.map((r) => r.id)).toEqual(["u-1", "u-2", "s1", "s2"]);
    const asha = page.rows.find((r) => r.id === "u-1")!;
    expect(asha.referral?.signups).toBe(5);                      // five signed up...
    expect(asha.referral?.uploaders.map((u) => u.name)).toEqual(["Student One", "Student Two"]); // ...two uploaded, earliest first
    expect(asha.referral?.uploaders.map((u) => u.shareMinor)).toEqual([10000, 10000]); // each referred person gets the full amount off their own fee
    expect(asha.referral?.perUploaderMinor).toBe(10000);
    expect(page.rows.find((r) => r.id === "u-2")!.name).toBeNull(); // display name equals the e-mail prefix: not a real name
    expect(page.rows.find((r) => r.id === "u-2")!.referral).toBeNull();
  });
  it("partners that belong to a user are not shown again in the partner list", async () => {
    await rf.adminSetUserReferral(ADMIN, { subjectId: "u-1", discountMinor: 100 }, ORIGIN);
    const names = (await rf.adminListPartners(ADMIN, ORIGIN)).map((p) => p.displayName);
    expect(names).not.toContain(expect.stringContaining("R-000001")); expect(names).toHaveLength(3);
  });
});


describe("link discount on the submission fee", () => {
  const REF = "referred-1";
  const reset = () => {
    T["referral_links"] = [{ id: "lA", partner_id: "pA", code: "AAAAAAAA", active: true, discount_minor: 20000 }, { id: "lB", partner_id: "pB", code: "BBBBBBBB", active: true, discount_minor: 30000 }, { id: "lC", partner_id: "pC", code: "CCCCCCCC", active: true, discount_minor: 99000 }];
    T["papers"] = [{ id: "paperR1", owner_id: REF, public_id: "P-1", title: "One" }, { id: "paperR2", owner_id: REF, public_id: "P-2", title: "Two" }];
    T["referral_user_attributions"] = [{ user_id: REF, partner_id: "pA", link_id: "lA" }];
    T["referral_paper_attributions"] = []; T["referral_discount_uses"] = []; T["payments"] = [];
    T["profiles"] = [{ id: REF, display_name: "Riya Sen", email: "riya@example.com" }];
  };
  beforeEach(reset);

  it("gives the discount of the link the person registered through", async () => {
    expect(await rf.referralDiscountFor(REF, "paperR1", 80000)).toEqual({ partnerId: "pA", linkId: "lA", amountMinor: 20000 });
  });
  it("gives nothing to someone who did not come through a link", async () => {
    T["referral_user_attributions"] = [];
    expect(await rf.referralDiscountFor(REF, "paperR1", 80000)).toBeNull();
  });
  it("two links never add up: the best single one counts", async () => {
    T["referral_paper_attributions"] = [{ paper_id: "paperR1", partner_id: "pB", link_id: "lB", share_percent: 100, source: "SUBMISSION_LINK" }];
    expect((await rf.referralDiscountFor(REF, "paperR1", 80000))?.amountMinor).toBe(30000);
  });
  it("a paused partner gives nothing, and a partner never discounts themselves", async () => {
    T["referral_user_attributions"] = [{ user_id: REF, partner_id: "pC", link_id: "lC" }];
    expect(await rf.referralDiscountFor(REF, "paperR1", 80000)).toBeNull();
    T["referral_partners"]!.find((p) => p.id === "pA")!.user_id = REF;
    expect(await rf.referralDiscountFor(REF, "paperR1", 80000)).toBeNull();
  });
  it("never takes the fee below Rs 1", async () => {
    T["referral_links"]!.find((l) => l.id === "lA")!.discount_minor = 5_000_000;
    expect((await rf.referralDiscountFor(REF, "paperR1", 80000))?.amountMinor).toBe(79900);
  });
  it("is used once per person: a live fee for another paper blocks a second discount, a cancelled one does not", async () => {
    T["payments"] = [{ id: "pay1", paper_id: "paperR1", status: "PAID" }];
    T["referral_discount_uses"] = [{ payment_id: "pay1", user_id: REF, partner_id: "pA", amount_minor: 20000 }];
    expect(await rf.referralDiscountFor(REF, "paperR2", 80000)).toBeNull();
    T["payments"]![0]!.status = "CANCELLED";
    expect((await rf.referralDiscountFor(REF, "paperR2", 80000))?.amountMinor).toBe(20000);
  });
  it("a refunded or paid fee for the same paper does not get a second discount either", async () => {
    T["payments"] = [{ id: "pay1", paper_id: "paperR1", status: "REFUNDED" }];
    T["referral_discount_uses"] = [{ payment_id: "pay1", user_id: REF, partner_id: "pA", amount_minor: 20000 }];
    expect(await rf.referralDiscountFor(REF, "paperR1", 80000)).toBeNull();
  });
  it("two checkouts at once: only one fee gets the discount", async () => {
    T["payments"] = [{ id: "payA", paper_id: "paperR1", status: "PENDING" }, { id: "payB", paper_id: "paperR2", status: "PENDING" }];
    const d = { partnerId: "pA", linkId: "lA", amountMinor: 20000 };
    expect(await rf.recordReferralDiscountUse("payA", REF, "paperR1", d)).toBe(true);
    expect(await rf.recordReferralDiscountUse("payB", REF, "paperR2", d)).toBe(false);
    expect(T["referral_discount_uses"]).toHaveLength(1);
    T["payments"]![0]!.status = "CANCELLED";
    expect(await rf.recordReferralDiscountUse("payB", REF, "paperR2", d)).toBe(true);
  });
  it("never throws: a database problem means no discount", async () => {
    failDb = true;
    await expect(rf.referralDiscountFor(REF, "paperR1", 80000)).resolves.toBeNull();
  });
  it("records the use against the person and partner, and reports it back for promo accounting", async () => {
    expect(await rf.recordReferralDiscountUse("pay9", REF, "paperR1", { partnerId: "pA", linkId: "lA", amountMinor: 20000 })).toBe(true);
    expect(T["referral_discount_uses"]).toEqual([expect.objectContaining({ payment_id: "pay9", user_id: REF, partner_id: "pA", amount_minor: 20000 })]);
    expect(await rf.referralDiscountOnPayment("pay9")).toBe(20000);
    expect(await rf.referralDiscountOnPayment("other")).toBe(0);
    const a = audits.find((x) => x.action === "referral_discount_applied")!;
    expect(JSON.stringify(a)).not.toMatch(/Alpha|Secret|riya/i); // the audit entry carries ids only
  });
  it("shows an administrator the person, their e-mail and whose link it was; refuses everyone else", async () => {
    T["payments"] = [{ id: "pay1", paper_id: "paperR1", status: "PAID", currency: "INR", amount_minor: 60000, original_amount_minor: 80000 }];
    T["referral_discount_uses"] = [{ payment_id: "pay1", user_id: REF, paper_id: "paperR1", partner_id: "pA", amount_minor: 20000, created_at: "2026-11-04T00:00:00Z" }];
    const page = await rf.adminListReferralDiscounts(ADMIN, 1);
    expect(page.total).toBe(1); expect(page.totalGivenMinor).toBe(20000);
    expect(page.rows[0]).toEqual(expect.objectContaining({ name: "Riya Sen", email: "riya@example.com", partnerName: "Alpha Secret Name", paperPublicId: "P-1", discountMinor: 20000, paidMinor: 60000, originalMinor: 80000, status: "PAID" }));
    await expect(rf.adminListReferralDiscounts(AUTHOR, 1)).rejects.toThrow("Forbidden");
  });
});
