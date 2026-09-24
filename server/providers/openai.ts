import { header, hostIs, str, type ProviderDef } from "./types";

export const openai: ProviderDef = {
  name: "openai",
  match: hostIs("api.openai.com", "chatgpt.com"),
  identify: (h) => {
    // Codex CLI: `session-id` is the root session, `thread-id` the (sub)agent's own thread.
    // Older Codex, Cline, Roo Code and Pi send `session_id`.
    const sessionId = header(h, "session-id", "session_id", "conversation_id");
    const thread = header(h, "thread-id");
    if (!sessionId || !thread || thread === sessionId) return { sessionId };
    return { sessionId, agentId: thread, agentName: header(h, "x-openai-subagent") };
  },
  // Codex, Zed, Copilot and opencode derive the prompt cache key from their session or thread id.
  fallback: (_h, body) => ({ sessionId: str(body?.prompt_cache_key) }),
};
