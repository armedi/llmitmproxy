import { header, str } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/** The LiteLLM proxy is self-hosted, so it has no host to match; its session fields apply anywhere. */
export const litellm: ProviderDef = {
  name: "litellm",
  match: () => false,
  identify: (h, body) => ({
    sessionId: header(h, "x-litellm-session-id") ?? str(body?.litellm_session_id) ?? str(body?.metadata?.session_id),
  }),
};
