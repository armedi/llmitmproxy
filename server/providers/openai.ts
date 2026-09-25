import { header, hostIs, str, type Headers, type ProviderDef } from "./types";

/** Codex's `x-codex-turn-metadata`: per turn in the WebSocket body's `client_metadata`, else the header. */
function codexTurn(h: Headers, body: any): any {
  for (const raw of [body?.client_metadata?.["x-codex-turn-metadata"], h["x-codex-turn-metadata"]]) {
    if (typeof raw !== "string") continue;
    try {
      return JSON.parse(raw);
    } catch {}
  }
  return undefined;
}

export const openai: ProviderDef = {
  name: "openai",
  match: hostIs("api.openai.com", "chatgpt.com"),
  identify: (h, body) => {
    // Codex CLI: `session-id` is the root session, `thread-id` the (sub)agent's own thread.
    // Older Codex, Cline, Roo Code and Pi send `session_id`.
    const sessionId = header(h, "session-id", "session_id", "conversation_id");
    const thread = header(h, "thread-id");
    // Codex generates the task title in a thread of its own. It names no parent today, so it stays
    // a standalone side call unless Codex sends the parent thread.
    const turn = codexTurn(h, body);
    if (sessionId && turn?.thread_source === "thread_title") {
      const parent = header(h, "x-codex-parent-thread-id") ?? str(turn.parent_thread_id);
      return { sessionId: parent ?? sessionId, agentId: `side:${thread ?? sessionId}`, agentName: "title", sideCall: true };
    }
    if (!sessionId || !thread || thread === sessionId) return { sessionId };
    return { sessionId, agentId: thread, agentName: header(h, "x-openai-subagent") };
  },
  // Codex, Zed, Copilot and opencode derive the prompt cache key from their session or thread id.
  fallback: (_h, body) => ({ sessionId: str(body?.prompt_cache_key) }),
};
