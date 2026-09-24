import { hostIs, str, type ProviderDef } from "./types";

/** Alibaba DashScope / Model Studio, including the coding and token plans. */
export const dashscope: ProviderDef = {
  name: "dashscope",
  match: hostIs("aliyuncs.com"),
  identify: (_h, body) => ({
    // Qwen Code's session (subagents share it), then the apps API's cloud-stored conversation.
    sessionId: str(body?.metadata?.sessionId) ?? str(body?.input?.session_id),
  }),
  // Qwen Code: `qwen-code:<session>[:partition]`.
  fallback: (_h, body) => ({ sessionId: str(body?.prompt_cache_key)?.match(/^qwen-code:([^:]+)/)?.[1] }),
};
