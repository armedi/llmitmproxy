import { hostIs, str } from "./helpers";
import type { ProviderDef } from "./types";

/**
 * OpenRouter's documented session id: body `session_id`, which wins over the `x-session-id`
 * header. That header is read by `generic`, which also links opencode subagents. Goose sets both.
 */
export const openrouter: ProviderDef = {
  name: "openrouter",
  match: hostIs("openrouter.ai"),
  identify: (_h, body) => ({ sessionId: str(body?.session_id) }),
};
