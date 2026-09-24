import { useEffect, useRef } from "react";
import type { Normalized, Usage } from "../server/types";

export type { Block, Message, Normalized, ToolDef, Usage } from "../server/types";

export interface Session {
  id: number;
  title: string;
  provider: string;
  model: string | null;
  session_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  client: string | null;
  parent_id: number | null;
  child_count: number;
  created_at: number;
  updated_at: number;
  request_count: number;
  latest_request_id: number;
  latest_msg_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number;
  unpriced: number;
  group_cost: number;
  pending: number;
  last_error: string | null;
  last_stop_reason: string | null;
}

interface RequestBase {
  id: number;
  state: "pending" | "done" | "error";
  provider: string;
  model: string | null;
  url: string;
  status: number | null;
  started_at: number;
  /** When the response headers arrived (captures from before this was recorded don't have it). */
  response_started_at: number | null;
  ended_at: number | null;
  msg_count: number;
  error: string | null;
  usage: Usage | null;
  cost: number | null;
}

/** A row of the session's request list. */
export interface RequestSummary extends RequestBase {
  stop_reason: string | null;
  tool_calls: string[];
}

export interface RequestDetail extends RequestBase {
  method: string;
  normalized: Normalized;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  request_body: string | null;
  response_body: string | null;
}

export type Update =
  | { type: "update"; session: Session; requestId: number; state: string }
  | { type: "deleted"; ids: number[] }
  | { type: "reset" };

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export const api = {
  sessions: () => get<Session[]>("/api/sessions"),
  request: (id: number) => get<RequestDetail>(`/api/requests/${id}`),
  requests: (sessionId: number) => get<RequestSummary[]>(`/api/sessions/${sessionId}/requests`),
  deleteSession: (id: number) => fetch(`/api/sessions/${id}`, { method: "DELETE" }),
  clear: () => fetch("/api/sessions", { method: "DELETE" }),
};

/** Subscribe to live updates, reconnecting with backoff. */
export function useUpdates(onUpdate: (u: Update) => void, onStatus: (connected: boolean) => void) {
  const cb = useRef({ onUpdate, onStatus });
  cb.current = { onUpdate, onStatus };
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry = 500;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 500;
        cb.current.onStatus(true);
      };
      ws.onmessage = (e) => cb.current.onUpdate(JSON.parse(e.data));
      ws.onclose = () => {
        cb.current.onStatus(false);
        if (!stopped) timer = setTimeout(connect, (retry = Math.min(retry * 2, 8000)));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);
}

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
