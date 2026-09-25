import { queryOptions } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import type { Normalized, Usage } from "../llm/types";

export type { Block, Message, Normalized, ToolDef, Usage } from "../llm/types";

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

// Live updates over /ws keep these current (see useLiveUpdates), so they never go stale on their own.
export const sessionsQuery = queryOptions({ queryKey: ["sessions"], queryFn: () => get<Session[]>("/api/sessions") });

/** Every request in a session, for the per-turn stats, vitals and the Raw view's picker. */
export const requestsQuery = (sessionId: number) =>
  queryOptions({ queryKey: ["requests", sessionId], queryFn: () => get<RequestSummary[]>(`/api/sessions/${sessionId}/requests`) });

export const requestQuery = (id: number) =>
  queryOptions({
    queryKey: ["request", id],
    queryFn: () => get<RequestDetail>(`/api/requests/${id}`),
    // Bodies can be megabytes; don't keep ones no longer shown for long.
    gcTime: 30_000,
  });

export const api = {
  deleteSession: (id: number) => fetch(`/api/sessions/${id}`, { method: "DELETE" }),
  clear: () => fetch("/api/sessions", { method: "DELETE" }),
};

/** Subscribe to live updates, reconnecting with backoff. */
export function useUpdates(onUpdate: (u: Update) => void, onStatus: (connected: boolean) => void) {
  const update = useEffectEvent(onUpdate);
  const status = useEffectEvent(onStatus);
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry = 500;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 500;
        status(true);
      };
      ws.onmessage = (e) => update(JSON.parse(e.data));
      ws.onclose = () => {
        status(false);
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
