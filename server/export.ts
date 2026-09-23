import { tryJSON } from "./parsers/sse";
import type { SessionRow, Store } from "./store";

/** Parse JSON bodies so the export is readable; SSE and other text stays a string. */
const body = (text: string | null) => (text == null ? null : (tryJSON(text) ?? text));

export function exportRequest(r: Record<string, any>) {
  return {
    id: r.id,
    state: r.state,
    method: r.method,
    url: r.url,
    status: r.status,
    started_at: new Date(r.started_at * 1000).toISOString(),
    ended_at: r.ended_at ? new Date(r.ended_at * 1000).toISOString() : null,
    error: r.error,
    request: { headers: r.request_headers, body: body(r.request_body) },
    response: { headers: r.response_headers, body: body(r.response_body) },
  };
}

export function exportSession(store: Store, session: SessionRow, scope: "latest" | "all") {
  const ids = scope === "all" ? store.listRequests(session.id).map((r) => r.id) : [session.latest_request_id];
  return {
    exported_at: new Date().toISOString(),
    session: {
      id: session.id,
      title: session.title,
      provider: session.provider,
      model: session.model,
      request_count: session.request_count,
      latest_request_id: session.latest_request_id,
    },
    requests: ids.map((id) => store.getRequest(id)).filter((r) => r != null).map(exportRequest),
  };
}

export function downloadName(session: SessionRow, suffix: string) {
  const slug = session.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `mitllmproxy-session-${session.id}${slug ? `-${slug}` : ""}-${suffix}.json`;
}
