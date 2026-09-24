import type { Session } from "./api";

/**
 * What a session is doing, from its latest request:
 * working (a request is in flight), error, waiting (answered, the user's turn),
 * stale (the model asked for a tool and nothing followed), or idle.
 */
export type Status = "working" | "error" | "waiting" | "stale" | "idle";

const WAITING_S = 10 * 60;
const TOOL_STOPS = new Set(["tool_use", "tool_calls", "function_call", "requires_action"]);

export function sessionStatus(s: Session, nowMs: number): Status {
  if (s.pending > 0) return "working";
  if (s.last_error) return "error";
  const idle = nowMs / 1000 - s.updated_at;
  if (idle > WAITING_S) return s.last_stop_reason && TOOL_STOPS.has(s.last_stop_reason) ? "stale" : "idle";
  // Tool calls are followed by the next request within seconds; if none came yet, the agent is still busy.
  return s.last_stop_reason && TOOL_STOPS.has(s.last_stop_reason) ? "working" : "waiting";
}

const RANK: Record<Status, number> = { working: 0, error: 1, waiting: 2, stale: 3, idle: 4 };

/** A group shows the most active status of its main session and children. */
export function groupStatus(sessions: Session[], nowMs: number): Status {
  return sessions.map((s) => sessionStatus(s, nowMs)).sort((a, b) => RANK[a] - RANK[b])[0] ?? "idle";
}

export const STATUS_LABEL: Record<Status, string> = {
  working: "Working: a request is in flight or a tool is running",
  error: "The latest request failed",
  waiting: "Answered: waiting for the user",
  stale: "Stopped after a tool call with no follow-up",
  idle: "Idle",
};
