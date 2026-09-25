import type { Headers, Identity } from "./types";

/**
 * For clients that give each subagent its own session id and point to the parent's:
 * the parent names the group and the child's own id names the subagent.
 */
export function withParent(own: string | undefined, parent: string | undefined, agentName?: string): Identity {
  if (!own) return {};
  if (!parent || parent === own) return { sessionId: own };
  return { sessionId: parent, agentId: own, agentName };
}

/** First non-empty header among `names`. The addon lowercases header names. */
export function header(headers: Headers, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = headers[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** `v` if it is a non-empty string or a finite number, as a string. */
export function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

export const hostIs =
  (...hosts: string[]) =>
  (url: URL) =>
    hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
