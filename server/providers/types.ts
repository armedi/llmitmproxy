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
