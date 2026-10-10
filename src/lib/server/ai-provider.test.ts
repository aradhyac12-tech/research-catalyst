import { afterEach, describe, expect, it } from "vitest";
import {
  AIUnavailableError, MemoryBudgetStore, MultiProviderAI, ProviderCallError, __makeTestingProvider, classifyHttpFailure, estimateReserveUsd,
  parseAiWire, redactSecrets, summarizeAiFailure, toProviderCallError, type BudgetStore, type ProviderDefinition,
} from "./ai-provider.server";

const ctx = { title: "t", abstract: "a", keywords: [], articleType: "x", field: "f", authors: [], declarations: {}, manuscriptText: "m" } as never;
const fast = { maxRetriesPerProvider: 1, backoffBaseMs: 1 };

const VALID = {
  study_type: "Original research", is_medical_or_human_subjects: false, confidence: 0.7, summary: "ok",
  signals: { human_subjects: false, animal_subjects: false, clinical_trial: false, patient_identifiable_info: false, ethics_approval_claimed_in_text: false, consent_claimed_in_text: false, trial_registration_in_text: false, embedded_instructions_detected: false, ai_generated_text_likelihood: "low" },
  checks: [],
};

/** A provider that records how often it was called and answers from a script. */
function scripted(name: "gemini" | "groq" | "anthropic", script: Array<Error | "ok">, estimateUsd = 0.01, costUsd = 0.01): ProviderDefinition & { calls: number } {
  const p = {
    calls: 0, name, model: name, privacyMode: "EXTERNAL_WITH_CONSENT" as const, estimateUsd: () => estimateUsd,
    async analyzeDocument() {
      const step = script[Math.min(p.calls, script.length - 1)]!;
      p.calls++;
      if (step !== "ok") throw step;
      return { provider: name, model: name, result: VALID as never, raw: JSON.stringify(VALID), inputTokens: 1, outputTokens: 1, costUsd };
    },
  };
  return p;
}
const httpErr = (status: number, msg: string) => new ProviderCallError(msg, classifyHttpFailure(status, msg), status);

describe("MultiProviderAI fallback", () => {
  it("falls back to the next provider when the first fails", async () => {
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", error: new Error("boom") }), __makeTestingProvider({ name: "groq", model: "q" })], fast);
    await expect(ai.analyzeDocument(ctx, "p1")).resolves.toBeTruthy();
  });
  it("walks Gemini -> Groq -> Anthropic and reports who answered", async () => {
    const g = scripted("gemini", [httpErr(503, "overloaded")]); const q = scripted("groq", [httpErr(429, "rate limited")]); const a = scripted("anthropic", ["ok"]);
    const out = await new MultiProviderAI([g, q, a], fast).analyzeDocument(ctx, "p4");
    expect(out.provider).toBe("anthropic");
    expect([g.calls, q.calls, a.calls]).toEqual([1, 1, 1]);
  });
  it("throws AIUnavailableError (ALL_FAILED) when all providers fail", async () => {
    const e = new Error("down");
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", error: e }), __makeTestingProvider({ name: "groq", model: "q", error: e }), __makeTestingProvider({ name: "anthropic", model: "a", error: e })], fast);
    const err = await ai.analyzeDocument(ctx, "p2").catch((x) => x);
    expect(err).toBeInstanceOf(AIUnavailableError);
    expect((err as AIUnavailableError).reason).toBe("ALL_FAILED");
    expect((err as AIUnavailableError).providerFailures).toHaveLength(3);
  });
  it("an instance with no providers reports unavailable instead of crashing", async () => {
    const err = await new MultiProviderAI([], fast).analyzeDocument(ctx, "p3").catch((x) => x);
    expect(err).toBeInstanceOf(AIUnavailableError);
    expect((err as AIUnavailableError).reason).toBe("NO_PROVIDER");
  });
  it("quota / auth / bad-request / invalid output are NOT retried on the same provider", async () => {
    for (const e of [httpErr(429, "You exceeded your current quota"), httpErr(401, "bad key"), httpErr(400, "bad request"), new ProviderCallError("output invalid", "INVALID_OUTPUT")]) {
      const g = scripted("gemini", [e]);
      await new MultiProviderAI([g, scripted("groq", ["ok"])], { maxRetriesPerProvider: 3, backoffBaseMs: 1 }).analyzeDocument(ctx, "pq");
      expect(g.calls).toBe(1);
    }
  });
  it("server errors, timeouts and plain rate limits ARE retried, then succeed", async () => {
    for (const e of [httpErr(503, "unavailable"), httpErr(429, "slow down"), toProviderCallError(Object.assign(new Error("t"), { name: "TimeoutError" }))]) {
      const g = scripted("gemini", [e, "ok"]);
      const out = await new MultiProviderAI([g], { maxRetriesPerProvider: 2, backoffBaseMs: 1 }).analyzeDocument(ctx, "pr");
      expect(out.provider).toBe("gemini");
      expect(g.calls).toBe(2);
    }
  });
  it("stops with reason DEADLINE instead of running past the time limit", async () => {
    const err = await new MultiProviderAI([scripted("gemini", ["ok"])], { ...fast, totalDeadlineMs: 1000 }).analyzeDocument(ctx, "pd").catch((x) => x);
    expect(err).toBeInstanceOf(AIUnavailableError);
    expect((err as AIUnavailableError).reason).toBe("DEADLINE");
  });
});

describe("AI budgets (reserve -> settle/release)", () => {
  it("budget exhaustion for one paper does not block another paper", async () => {
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", costUsd: 0.3 })], { ...fast, maxCostPerPaperUsd: 0.5 });
    await expect(ai.analyzeDocument(ctx, "A")).resolves.toBeTruthy();
    const err = await ai.analyzeDocument(ctx, "A").catch((x) => x);
    expect(err).toBeInstanceOf(AIUnavailableError);
    expect((err as AIUnavailableError).budgetExhausted).toBe(true);
    await expect(ai.analyzeDocument(ctx, "B")).resolves.toBeTruthy();
  });
  it("a shared ledger enforces the caps across brand-new instances (restart / second server)", async () => {
    const store = new MemoryBudgetStore();
    const mk = () => new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", costUsd: 0.3 })], { ...fast, maxCostPerPaperUsd: 0.5 }, store);
    await mk().analyzeDocument(ctx, "A");
    await expect(mk().analyzeDocument(ctx, "A")).rejects.toBeInstanceOf(AIUnavailableError);
  });
  it("CONCURRENT calls on one paper cannot overspend the per-paper cap", async () => {
    const store = new MemoryBudgetStore();
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", costUsd: 0.1, delayMs: 15 })], { ...fast, maxCostPerPaperUsd: 0.5 }, store);
    const res = await Promise.allSettled(Array.from({ length: 12 }, () => ai.analyzeDocument(ctx, "P")));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(7);
    expect(store.totals("P").paperUsd).toBeLessThanOrEqual(0.5 + 1e-9);
  });
  it("CONCURRENT calls across papers cannot overspend the daily cap", async () => {
    const store = new MemoryBudgetStore();
    const ai = new MultiProviderAI([__makeTestingProvider({ name: "gemini", model: "g", costUsd: 0.1, delayMs: 15 })], { ...fast, maxCostPerPaperUsd: 5, maxGlobalCostPerDayUsd: 0.3 }, store);
    const res = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => ai.analyzeDocument(ctx, `paper-${i}`)));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(store.totals("paper-0").dayUsd).toBeLessThanOrEqual(0.3 + 1e-9);
    const failed = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as AIUnavailableError).reason).toBe("BUDGET");
  });
  it("fails closed when the ledger cannot be reached (no provider is called)", async () => {
    const store: BudgetStore = { reserve: async () => { throw new Error("db down"); }, settle: async () => undefined, release: async () => undefined };
    const g = scripted("gemini", ["ok"]);
    const err = await new MultiProviderAI([g], fast, store).analyzeDocument(ctx, "A").catch((x) => x);
    expect((err as AIUnavailableError).reason).toBe("LEDGER");
    expect(g.calls).toBe(0);
  });
  it("a provider whose worst case does not fit the remaining paper budget is skipped; a cheaper one still answers", async () => {
    const dear = scripted("anthropic", ["ok"], 0.45); const cheap = scripted("groq", ["ok"], 0.01);
    const out = await new MultiProviderAI([dear, cheap], { ...fast, maxCostPerPaperUsd: 0.4 }).analyzeDocument(ctx, "S");
    expect(out.provider).toBe("groq");
    expect(dear.calls).toBe(0);
  });
  it("an answer that is billed but unusable (invalid JSON) is still recorded as spend", async () => {
    const store = new MemoryBudgetStore();
    const bad = new ProviderCallError("Gemini output invalid", "INVALID_OUTPUT", undefined, { inputTokens: 10, outputTokens: 10, costUsd: 0.2 });
    await new MultiProviderAI([scripted("gemini", [bad]), scripted("groq", ["ok"], 0.01, 0.05)], fast, store).analyzeDocument(ctx, "I");
    expect(store.totals("I").paperUsd).toBeCloseTo(0.25, 6);
  });
  it("a provider error response is NOT billed (reservation released); a timeout IS assumed spent", async () => {
    const s1 = new MemoryBudgetStore();
    await new MultiProviderAI([scripted("gemini", [httpErr(503, "unavailable")], 0.2), scripted("groq", ["ok"], 0.01, 0.01)], fast, s1).analyzeDocument(ctx, "R");
    expect(s1.totals("R").paperUsd).toBeCloseTo(0.01, 6);
    const s2 = new MultiProviderAI([scripted("gemini", [new ProviderCallError("timed out", "TIMEOUT")], 0.2), scripted("groq", ["ok"], 0.01, 0.01)], fast, (() => { const s = new MemoryBudgetStore(); (s2Store.s = s); return s; })());
    await s2.analyzeDocument(ctx, "T");
    expect(s2Store.s!.totals("T").paperUsd).toBeCloseTo(0.21, 6);
  });
});
const s2Store: { s?: MemoryBudgetStore } = {};

describe("provider plumbing", () => {
  it("classifies HTTP failures", () => {
    expect(classifyHttpFailure(429, "Rate limit reached")).toBe("RATE_LIMIT");
    expect(classifyHttpFailure(429, "You exceeded your current quota")).toBe("QUOTA");
    expect(classifyHttpFailure(402, "")).toBe("QUOTA");
    expect(classifyHttpFailure(401, "")).toBe("AUTH");
    expect(classifyHttpFailure(403, "")).toBe("AUTH");
    expect(classifyHttpFailure(400, "")).toBe("BAD_REQUEST");
    expect(classifyHttpFailure(503, "")).toBe("SERVER");
    expect(classifyHttpFailure(529, "overloaded")).toBe("SERVER");
    expect(classifyHttpFailure(408, "")).toBe("TIMEOUT");
  });
  it("redacts keys from messages", () => {
    process.env["GEMINI_API_KEY"] = "AIzaSyFAKEKEY1234567890";
    expect(redactSecrets("GET https://x/y?key=AIzaSyFAKEKEY1234567890&a=1 failed")).not.toContain("AIzaSyFAKEKEY1234567890");
    expect(redactSecrets("Authorization: Bearer sk-abcdef1234567890")).not.toContain("sk-abcdef1234567890");
    expect(new ProviderCallError("bad AIzaSyFAKEKEY1234567890", "AUTH").message).not.toContain("AIzaSyFAKEKEY1234567890");
    delete process.env["GEMINI_API_KEY"];
  });
  it("estimateReserveUsd is an upper bound that grows with the prompt and is dearest for Anthropic", () => {
    expect(estimateReserveUsd("anthropic", 50_000)).toBeGreaterThan(estimateReserveUsd("anthropic", 1000));
    expect(estimateReserveUsd("anthropic", 50_000)).toBeGreaterThan(estimateReserveUsd("gemini", 50_000));
  });
  it("parseAiWire rejects non-JSON and wrong shapes, accepts a valid answer", () => {
    expect(() => parseAiWire("I cannot help with that")).toThrow();
    expect(() => parseAiWire(JSON.stringify({ hello: 1 }))).toThrow();
    expect(parseAiWire("```json\n" + JSON.stringify(VALID) + "\n```").study_type).toBe("Original research");
  });
  it("summarizeAiFailure lists provider outcomes without secrets", () => {
    const e = new AIUnavailableError("All failed", [{ provider: "gemini", error: "x", code: "429", retryable: false }], false, "ALL_FAILED");
    expect(summarizeAiFailure(e)).toContain("gemini:429");
  });
});

describe("real provider calls (fetch stubbed)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const gemOk = { candidates: [{ content: { parts: [{ text: JSON.stringify(VALID) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } };

  it("Gemini key goes in a header (never the URL), with a timeout signal; quota error falls through to Groq without retry", async () => {
    process.env["GEMINI_API_KEY"] = "gem-key-1234567890"; process.env["GROQ_API_KEY"] = "groq-key-1234567890";
    const calls: Array<{ url: string; headers: Record<string, string>; signal: unknown }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, signal: init.signal });
      return String(url).includes("generativelanguage") ? json(429, { error: { message: "You exceeded your current quota" } }) : json(200, { choices: [{ message: { content: JSON.stringify(VALID) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    }) as never;
    const out = await new MultiProviderAI(undefined, { backoffBaseMs: 1, maxRetriesPerProvider: 3 }).analyzeDocument(ctx, "F");
    expect(out.provider).toBe("groq");
    const gem = calls.filter((c) => c.url.includes("generativelanguage"));
    expect(gem).toHaveLength(1);
    expect(gem[0]!.url).not.toContain("key=");
    expect(gem[0]!.url).not.toContain("gem-key-1234567890");
    expect(gem[0]!.headers["x-goog-api-key"]).toBe("gem-key-1234567890");
    expect(gem[0]!.signal).toBeTruthy();
  });
  it("invalid JSON from the first provider is billed from real usage and the next provider answers", async () => {
    process.env["GEMINI_API_KEY"] = "gem-key-1234567890"; process.env["GROQ_API_KEY"] = "groq-key-1234567890";
    globalThis.fetch = (async (url: string) => String(url).includes("generativelanguage")
      ? json(200, { candidates: [{ content: { parts: [{ text: "Sorry, here is prose, not JSON" }] } }], usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 } })
      : json(200, { choices: [{ message: { content: JSON.stringify(VALID) } }], usage: { prompt_tokens: 0, completion_tokens: 0 } })) as never;
    const store = new MemoryBudgetStore();
    const out = await new MultiProviderAI(undefined, { backoffBaseMs: 1, maxCostPerPaperUsd: 5 }, store).analyzeDocument(ctx, "G");
    expect(out.provider).toBe("groq");
    expect(store.totals("G").paperUsd).toBeGreaterThanOrEqual(0.075); // 1M Gemini input tokens at $0.075/M, recorded although the answer was unusable
  });
  it("non-JSON error pages and dropped connections become provider failures, then human routing (AIUnavailableError)", async () => {
    process.env["ANTHROPIC_API_KEY"] = "ant-key-1234567890";
    let n = 0;
    globalThis.fetch = (async () => { n++; if (n === 1) return new Response("<html>502</html>", { status: 502 }); throw new TypeError("fetch failed"); }) as never;
    const err = await new MultiProviderAI(undefined, { backoffBaseMs: 1, maxRetriesPerProvider: 2 }).analyzeDocument(ctx, "H").catch((x) => x);
    expect(err).toBeInstanceOf(AIUnavailableError);
    expect((err as AIUnavailableError).providerFailures).toHaveLength(2);
    expect(n).toBe(2);
  });
  it("a hung provider is cut off by the timeout instead of hanging forever", async () => {
    process.env["ANTHROPIC_API_KEY"] = "ant-key-1234567890";
    globalThis.fetch = ((_u: string, init: RequestInit) => new Promise((_res, rej) => { (init.signal as AbortSignal).addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))); })) as never;
    const keepAlive = setInterval(() => undefined, 100); // AbortSignal.timeout timers are unref'd; a real server keeps the loop alive
    const t0 = Date.now();
    const err = await new MultiProviderAI(undefined, { providerTimeoutMs: 1000, totalDeadlineMs: 20_000, maxRetriesPerProvider: 1 }).analyzeDocument(ctx, "X").catch((x) => x);
    expect(err).toBeInstanceOf(AIUnavailableError);
    clearInterval(keepAlive);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  void gemOk;
});
