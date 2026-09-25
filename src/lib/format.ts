import type { Usage } from "../llm/types";

export function fmtTokens(n: number | undefined | null): string {
  if (n == null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtDuration(start: number, end: number | null): string {
  if (!end) return "…";
  return fmtSeconds(end - start);
}

export function fmtSeconds(s: number): string {
  if (s < 10) return `${s.toFixed(2)}s`;
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return "–";
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

/** Full prompt size of a response: uncached input plus cache reads and writes. */
export const contextTokens = (u: Usage | null | undefined) => (u ? (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0);

export function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
