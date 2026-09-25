import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Usage } from "./types";

/** Dollars per million tokens. Cache prices fall back to the input price when missing. */
export interface Price {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelPrice extends Price {
  /** Higher rates once the prompt (input + cache) exceeds `above` tokens. */
  tiers?: (Price & { above: number })[];
}

export interface Pricing {
  models: Record<string, ModelPrice>;
  /** Changes whenever the prices change, so stored costs can be recomputed. */
  hash: string;
}

const SNAPSHOT_PATH = resolve(import.meta.dir, "..", "config", "pricing.json");

const readModels = (path: string): Record<string, ModelPrice> => {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Object.fromEntries(Object.entries(data.models ?? {}).map(([k, v]) => [k.toLowerCase(), v as ModelPrice]));
  } catch (e) {
    console.warn(`pricing: cannot read ${path}: ${e}`);
    return {};
  }
};

/**
 * The shipped snapshot, overlaid with `pricing.json` next to the database when present
 * (same format: `{"models": {"my-model": {"input": 1, "output": 2}}}`).
 */
export function loadPricing(dbPath?: string): Pricing {
  const models = readModels(SNAPSHOT_PATH);
  const override = dbPath && dbPath !== ":memory:" ? resolve(dirname(dbPath), "pricing.json") : undefined;
  if (override && existsSync(override)) Object.assign(models, readModels(override));
  return { models, hash: Bun.hash(JSON.stringify(models)).toString(36) };
}

/** Reduce a model id as sent on the wire to a catalog name. */
export function normalizeModel(model: string): string {
  return model
    .toLowerCase()
    .trim()
    .replace(/\[[^\]]*\]$/, "") // Claude Code's "[1m]" context suffix
    .split("/")
    .pop()!
    .replace(/^(us|eu|apac|global)\./, "") // Bedrock cross-region prefixes
    .replace(/^anthropic\./, "")
    .replace(/-v\d+(:\d+)?$/, "") // Bedrock version suffix
    .replace(/@\d{8}$/, "") // Vertex date suffix
    .replace(/:.*$/, "");
}

const cache = new WeakMap<Pricing, Map<string, ModelPrice | null>>();

export function priceFor(pricing: Pricing, model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  let memo = cache.get(pricing);
  if (!memo) cache.set(pricing, (memo = new Map()));
  if (memo.has(model)) return memo.get(model)!;
  const name = normalizeModel(model);
  const m = pricing.models;
  let found = m[name] ?? m[name.replace(/-\d{8}$/, "")] ?? m[name.replace(/-latest$/, "")];
  if (!found) {
    // Longest catalog name that prefixes the model, e.g. "gpt-5.1-codex-2026-01" → "gpt-5.1-codex".
    let best = "";
    for (const k of Object.keys(m)) if (k.length > best.length && name.startsWith(k) && /[-._]/.test(name[k.length] ?? "")) best = k;
    found = best ? m[best] : undefined;
  }
  memo.set(model, found ?? null);
  return found ?? null;
}

/** Estimated dollars for one response, or null when the model's price is unknown. */
export function costOf(pricing: Pricing, usage: Usage | null | undefined, model: string | null | undefined): number | null {
  if (!usage) return null;
  const p = priceFor(pricing, model);
  if (!p) return null;
  const input = usage.input ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const prompt = input + cacheRead + cacheWrite;
  const tier = p.tiers?.filter((t) => prompt > t.above).sort((a, b) => b.above - a.above)[0];
  const rate = (k: keyof Price) => tier?.[k] ?? p[k];
  const inRate = rate("input") ?? 0;
  return (
    (input * inRate +
      cacheRead * (rate("cacheRead") ?? inRate) +
      cacheWrite * (rate("cacheWrite") ?? inRate) +
      (usage.output ?? 0) * (rate("output") ?? 0)) /
    1e6
  );
}
