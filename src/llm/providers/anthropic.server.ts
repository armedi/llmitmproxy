import { header, hostIs, str } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/** Claude Code puts the session id in metadata.user_id, either as JSON or as `..._session_<uuid>`. */
function userIdSession(body: any): string | undefined {
  const uid = body?.metadata?.user_id;
  if (typeof uid !== "string") return undefined;
  try {
    const sid = str(JSON.parse(uid)?.session_id);
    if (sid) return sid;
  } catch {
    // not JSON
  }
  return uid.match(/session_([0-9a-f-]{8,})/i)?.[1];
}

export const anthropic: ProviderDef = {
  name: "anthropic",
  match: hostIs("api.anthropic.com"),
  identify: (h, body) => ({
    // Claude Code declares its session in a header; subagents add their own id and type.
    sessionId: header(h, "x-claude-code-session-id") ?? userIdSession(body),
    agentId: header(h, "x-claude-code-agent-id"),
    agentName: header(h, "x-claude-code-agent-type"),
  }),
  // Kimi CLI sends the bare session UUID as the user id. Elsewhere it may be a real user id.
  fallback: (_h, body) => ({ sessionId: str(body?.metadata?.user_id)?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] }),
};
