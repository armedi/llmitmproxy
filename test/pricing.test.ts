import { describe, expect, test } from "vitest";
import { costOf, loadPricing, normalizeModel, type Pricing, priceFor } from "../src/llm/pricing.server";

const pricing: Pricing = {
  hash: "t",
  models: {
    "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tiers: [{ above: 200_000, input: 6, output: 22.5 }] },
    "gpt-5.1-codex": { input: 1.25, output: 10, cacheRead: 0.125 },
    "gpt-5.1": { input: 1, output: 8 },
  },
};

describe("model names", () => {
  test("wire ids normalize to catalog names", () => {
    expect(normalizeModel("claude-opus-4-6[1m]")).toBe("claude-opus-4-6");
    expect(normalizeModel("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe("claude-sonnet-4-5-20250929");
    expect(normalizeModel("models/gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(normalizeModel("anthropic/claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeModel("claude-sonnet-4-5@20250929")).toBe("claude-sonnet-4-5");
  });

  test("exact, dated and longest-prefix matches", () => {
    expect(priceFor(pricing, "claude-sonnet-5")?.input).toBe(3);
    expect(priceFor(pricing, "claude-sonnet-5-20260101")?.input).toBe(3);
    expect(priceFor(pricing, "gpt-5.1-codex-mini")?.input).toBe(1.25);
    expect(priceFor(pricing, "gpt-5.1-2026-01-01")?.input).toBe(1);
    expect(priceFor(pricing, "gpt-5.10")).toBeNull();
    expect(priceFor(pricing, "mystery-model")).toBeNull();
    expect(priceFor(pricing, null)).toBeNull();
  });
});

describe("cost", () => {
  test("input, cache and output rates", () => {
    const c = costOf(pricing, { input: 1000, cacheRead: 10_000, cacheWrite: 2000, output: 500 }, "claude-sonnet-5")!;
    expect(c).toBeCloseTo((1000 * 3 + 10_000 * 0.3 + 2000 * 3.75 + 500 * 15) / 1e6);
  });

  test("cache price falls back to input price", () => {
    expect(costOf(pricing, { input: 0, cacheRead: 1_000_000 }, "gpt-5.1")).toBeCloseTo(1);
  });

  test("tier applies above the prompt threshold, missing tier rates fall back", () => {
    const c = costOf(pricing, { input: 150_000, cacheRead: 100_000, output: 1000 }, "claude-sonnet-5")!;
    expect(c).toBeCloseTo((150_000 * 6 + 100_000 * 0.3 + 1000 * 22.5) / 1e6);
  });

  test("unknown model or no usage is null", () => {
    expect(costOf(pricing, { input: 1 }, "nope")).toBeNull();
    expect(costOf(pricing, null, "claude-sonnet-5")).toBeNull();
  });

  test("the shipped snapshot prices common models", () => {
    const p = loadPricing();
    for (const m of ["claude-sonnet-4-5", "gpt-5", "gemini-2.5-pro"]) expect(priceFor(p, m)).not.toBeNull();
  });
});
