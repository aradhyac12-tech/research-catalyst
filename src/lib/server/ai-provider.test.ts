import { describe, expect, it } from "vitest";
import { AIUnavailableError, MultiProviderAI, __makeTestingProvider, type BudgetStore } from "./ai-provider.server";

const ctx = { title: "t", abstract: "a", keywords: [], articleType: "x", field: "f", authors: [], declarations: {}, manuscriptText: "m" } as never;
const fast = { maxRetriesPerProvider: 1 };

describe("MultiProviderAI fallback and budgets", () => {
  it("falls back to the next provider when the first fails", async () => {
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", error: new Error("boom") }), __makeTestingProvider({ name: "groq", model: "q" })], fast);
    await expect(ai.analyzeDocument(ctx, "p1")).resolves.toBeTruthy();
  });
  it("throws AIUnavailableError when all providers fail", async () => {
    const e = new Error("down");
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", error: e }), __makeTestingProvider({ name: "groq", model: "q", error: e }), __makeTestingProvider({ name: "anthropic", model: "a", error: e })], fast);
    await expect(ai.analyzeDocument(ctx, "p2")).rejects.toBeInstanceOf(AIUnavailableError);
  });
  it("budget exhaustion for one paper does not block another paper", async () => {
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", costUsd: 0.3 })], { ...fast, maxCostPerPaperUsd: 0.5 });
    await expect(ai.analyzeDocument(ctx, "A")).resolves.toBeTruthy();
    await expect(ai.analyzeDocument(ctx, "A")).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(ai.analyzeDocument(ctx, "B")).resolves.toBeTruthy();
  });
  it("an instance with no providers reports unavailable instead of crashing at construction", async () => {
    const ai = new MultiProviderAI([], fast);
    await expect(ai.analyzeDocument(ctx, "p3")).rejects.toBeInstanceOf(AIUnavailableError);
  });
  it("reports which provider answered", async () => {
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", error: new Error("x") }), __makeTestingProvider({ name: "groq", model: "q" })], fast);
    const out = await ai.analyzeDocument(ctx, "p4");
    expect(out.provider).toBe("groq");
  });
  it("durable ledger: spend recorded and caps survive a new instance", async () => {
    const rows: Record<string, number> = {};
    const store: BudgetStore = {
      totals: async (p) => ({ paperUsd: rows[p] ?? 0, dayUsd: Object.values(rows).reduce((a, b) => a + b, 0) }),
      add: async (p, _pr, _m, c) => { rows[p] = (rows[p] ?? 0) + c; },
    };
    const mk = () => new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", costUsd: 0.3 })], { ...fast, maxCostPerPaperUsd: 0.5 }, store);
    await mk().analyzeDocument(ctx, "A");
    await mk().analyzeDocument(ctx, "A").catch(() => undefined); // second spend takes it over the cap
    await expect(mk().analyzeDocument(ctx, "A")).rejects.toBeInstanceOf(AIUnavailableError); // brand-new instance still sees the cap
  });
  it("fails closed when the ledger cannot be read", async () => {
    const store: BudgetStore = { totals: async () => { throw new Error("db down"); }, add: async () => undefined };
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g" })], fast, store);
    await expect(ai.analyzeDocument(ctx, "A")).rejects.toBeInstanceOf(AIUnavailableError);
  });
});
