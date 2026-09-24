import { hostIs, str, type ProviderDef } from "./types";

/**
 * Moonshot / Kimi, including Kimi Code. Here `prompt_cache_key` is documented as the session
 * or task id and is required by the Kimi Code plan; Kimi CLI sets it to its session UUID,
 * shared by subagents.
 */
export const kimi: ProviderDef = {
  name: "kimi",
  match: hostIs("moonshot.ai", "moonshot.cn", "kimi.com"),
  identify: (_h, body, own) => ({ sessionId: own ? str(body?.prompt_cache_key) : undefined }),
};
