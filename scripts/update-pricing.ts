#!/usr/bin/env bun
/**
 * Refresh config/pricing.json from LiteLLM's model price catalog.
 *
 *     bun scripts/update-pricing.ts [path-or-url]
 *
 * Keeps chat models from the providers coding agents talk to, keyed by the bare model
 * name (no "provider/" prefix), with prices in dollars per million tokens.
 */
import { resolve } from "node:path";

const SOURCE = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OUT = resolve(import.meta.dir, "..", "config", "pricing.json");

/** Earlier providers win when two list the same model name. */
const PROVIDERS = [
  "anthropic",
  "openai",
  "gemini",
  "vertex_ai-language-models",
  "xai",
  "deepseek",
  "dashscope",
  "moonshot",
  "minimax",
  "zai",
  "mistral",
  "openrouter",
];
const TIERS = [32, 128, 200, 256, 272, 512];

const arg = process.argv[2] ?? SOURCE;
const raw: Record<string, any> = arg.startsWith("http") ? await (await fetch(arg)).json() : await Bun.file(arg).json();

const perM = (v: unknown) => (typeof v === "number" ? Math.round(v * 1e6 * 1e6) / 1e6 : undefined);

function prices(e: any, suffix = "") {
  return {
    input: perM(e[`input_cost_per_token${suffix}`]),
    output: perM(e[`output_cost_per_token${suffix}`]),
    cacheRead: perM(e[`cache_read_input_token_cost${suffix}`]),
    cacheWrite: perM(e[`cache_creation_input_token_cost${suffix}`]),
  };
}

const out: Record<string, unknown> = {};
const rank = (p: string) => PROVIDERS.indexOf(p);
const entries = Object.entries(raw)
  .filter(([, e]) => e && typeof e === "object" && (e.mode === "chat" || e.mode === "responses") && rank(e.litellm_provider) >= 0)
  .filter(([, e]) => typeof e.input_cost_per_token === "number" && typeof e.output_cost_per_token === "number")
  .sort(([, a], [, b]) => rank(a.litellm_provider) - rank(b.litellm_provider));

for (const [key, e] of entries) {
  const name = key.split("/").pop()!.toLowerCase();
  // Skip batch/flex variants ("model:batch"); captured traffic is interactive.
  if (name.includes(":") || out[name]) continue;
  const tiers = TIERS.filter((k) => typeof e[`input_cost_per_token_above_${k}k_tokens`] === "number").map((k) => ({
    above: k * 1000,
    ...prices(e, `_above_${k}k_tokens`),
  }));
  out[name] = { ...prices(e), ...(tiers.length ? { tiers } : {}) };
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
await Bun.write(OUT, `${JSON.stringify({ source: SOURCE, updated: new Date().toISOString().slice(0, 10), models: sorted }, null, 1)}\n`);
console.log(`wrote ${Object.keys(sorted).length} models to ${OUT}`);
