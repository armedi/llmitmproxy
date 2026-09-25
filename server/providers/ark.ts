import { hostIs, str } from "./helpers";
import type { ProviderDef } from "./types";

/** Volcengine Ark (Doubao) and BytePlus ModelArk. */
export const ark: ProviderDef = {
  name: "ark",
  match: hostIs("volces.com", "bytepluses.com"),
  identify: () => ({}),
  // Responses `session.id` is only seen in the SDK, and a context cache may be shared, so both are approximate.
  fallback: (_h, body, own) => ({ sessionId: own ? (str(body?.session?.id) ?? str(body?.context_id)) : undefined }),
};
