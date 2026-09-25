import { hostIs, str } from "./helpers";
import type { ProviderDef } from "./types";

/**
 * Zed's hosted models (cloud.zed.dev). The request envelope carries the agent thread id.
 * Agent turns also carry a `prompt_id`; calls made for the thread without one (title
 * generation) are side calls.
 */
export const zed: ProviderDef = {
  name: "zed",
  match: hostIs("zed.dev"),
  identify: (_h, body, own) => {
    const sessionId = str(body?.thread_id);
    if (!sessionId) return {};
    return own && !str(body?.prompt_id) ? { sessionId, sideCall: true } : { sessionId };
  },
};
