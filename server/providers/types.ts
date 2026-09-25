export type Headers = Record<string, string>;

/** Who a request belongs to, as declared by the client. */
export interface Identity {
  /** The client's own session id; requests sharing it form one group. */
  sessionId?: string;
  /** A subagent inside that session. */
  agentId?: string;
  /** The subagent's type or name. */
  agentName?: string;
  /** A one-off call made for the session, such as title generation. It never continues a conversation. */
  sideCall?: boolean;
}

/**
 * An API provider or router, matched by the request URL.
 * `identify` reads the session headers and body fields that clients of this provider send.
 * `fallback` reads keys that only approximate a session (such as a prompt cache key); it is
 * used only when no provider finds a declared session id.
 */
export interface ProviderDef {
  name: string;
  match: (url: URL) => boolean;
  /** `own` is true when this provider serves the request, for rules that only hold on its hosts. */
  identify: (headers: Headers, body: any, own: boolean) => Identity;
  fallback?: (headers: Headers, body: any, own: boolean) => Identity;
}

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
