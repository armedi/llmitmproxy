import type { RequestSummary, Usage } from "../api";
import { contextTokens } from "../api";

export interface Turn {
  request: RequestSummary;
  /** 1-based position of the request in the session. */
  ordinal: number;
}

/**
 * Which request produced each assistant message: a request that sent `k` messages got back
 * message `k`. A retry with the same count replaces the earlier one.
 */
export function turnsByIndex(requests: RequestSummary[], upToMsgCount: number): Map<number, Turn> {
  const out = new Map<number, Turn>();
  requests.forEach((request, i) => {
    if (request.msg_count <= upToMsgCount) out.set(request.msg_count, { request, ordinal: i + 1 });
  });
  return out;
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (pos - lo);
};

export interface Vitals {
  requests: number;
  pending: number;
  errors: number;
  startedAt: number | null;
  endedAt: number | null;
  totals: Required<Omit<Usage, "total">>;
  cacheHitRate: number | null;
  peakContext: number;
  currentContext: number;
  contextSeries: number[];
  cost: number;
  unpriced: number;
  costByModel: { model: string; cost: number; requests: number }[];
  p50: number | null;
  p90: number | null;
  avgHeaders: number | null;
  slowest: RequestSummary | null;
  longest: number;
  tools: { name: string; count: number }[];
}

export const duration = (r: RequestSummary) => (r.ended_at != null ? r.ended_at - r.started_at : null);

export function vitals(requests: RequestSummary[]): Vitals {
  const done = requests.filter((r) => r.state !== "pending");
  const durations = done.map(duration).filter((d): d is number => d != null);
  const sorted = [...durations].sort((a, b) => a - b);
  const headers = done.filter((r) => r.response_started_at != null).map((r) => r.response_started_at! - r.started_at);
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const byModel = new Map<string, { cost: number; requests: number }>();
  const tools = new Map<string, number>();
  let cost = 0;
  let unpriced = 0;
  for (const r of requests) {
    const u = r.usage;
    if (u) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += u[k] ?? 0;
    if (r.cost != null) cost += r.cost;
    else if (u) unpriced++;
    const m = byModel.get(r.model ?? "unknown") ?? { cost: 0, requests: 0 };
    m.cost += r.cost ?? 0;
    m.requests++;
    byModel.set(r.model ?? "unknown", m);
    for (const t of r.tool_calls) tools.set(t, (tools.get(t) ?? 0) + 1);
  }
  const series = requests.filter((r) => r.usage).map((r) => contextTokens(r.usage));
  const prompt = totals.input + totals.cacheRead + totals.cacheWrite;
  let slowest: RequestSummary | null = null;
  for (const r of done) if (duration(r) != null && (!slowest || duration(r)! > duration(slowest)!)) slowest = r;
  return {
    requests: requests.length,
    pending: requests.length - done.length,
    errors: requests.filter((r) => r.state === "error" || (r.status ?? 0) >= 400).length,
    startedAt: requests[0]?.started_at ?? null,
    endedAt: requests.reduce<number | null>((a, r) => (r.ended_at != null && (a == null || r.ended_at > a) ? r.ended_at : a), null),
    totals,
    cacheHitRate: prompt ? totals.cacheRead / prompt : null,
    peakContext: Math.max(0, ...series),
    currentContext: series[series.length - 1] ?? 0,
    contextSeries: series,
    cost,
    unpriced,
    costByModel: [...byModel].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.cost - a.cost || b.requests - a.requests),
    p50: sorted.length ? quantile(sorted, 0.5) : null,
    p90: sorted.length ? quantile(sorted, 0.9) : null,
    avgHeaders: headers.length ? headers.reduce((a, b) => a + b, 0) / headers.length : null,
    slowest,
    longest: sorted[sorted.length - 1] ?? 0,
    tools: [...tools].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}
