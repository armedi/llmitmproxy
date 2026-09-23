import { useEffect, useRef } from "react";
import type { Normalized, Usage } from "../server/types";

export type { Block, Message, Normalized, ToolDef, Usage } from "../server/types";

export interface Session {
  id: number;
  title: string;
  provider: string;
  model: string | null;
  hint: string | null;
  created_at: number;
  updated_at: number;
  request_count: number;
  latest_request_id: number;
  latest_msg_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  pending: number;
  last_error: string | null;
}

export interface RequestSummary {
  id: number;
  state: "pending" | "done" | "error";
  model: string | null;
  status: number | null;
  started_at: number;
  ended_at: number | null;
  msg_count: number;
  error: string | null;
}

export interface RequestDetail extends RequestSummary {
  provider: string;
  url: string;
  method: string;
  normalized: Normalized;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  request_body: string | null;
  response_body: string | null;
  usage: Usage | null;
}

export type Update =
  | { type: "update"; session: Session; requestId: number; state: string }
  | { type: "deleted"; id: number }
  | { type: "reset" };

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export const api = {
  sessions: () => get<Session[]>("/api/sessions"),
  session: (id: number) => get<{ session: Session; requests: RequestSummary[] }>(`/api/sessions/${id}`),
  request: (id: number) => get<RequestDetail>(`/api/requests/${id}`),
  deleteSession: (id: number) => fetch(`/api/sessions/${id}`, { method: "DELETE" }),
  clear: () => fetch("/api/sessions", { method: "DELETE" }),
  config: () => get<{ path: string; config: any }>("/api/config"),
  saveConfig: (config: unknown) =>
    fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) }),
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
  const s = end - start;
  return s < 10 ? `${s.toFixed(2)}s` : `${s.toFixed(1)}s`;
}
