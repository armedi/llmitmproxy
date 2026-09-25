import { header, withParent } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/**
 * Conventions not tied to one provider, for any host.
 * opencode, Crush and Pi send `x-session-id` to every provider (opencode adds
 * `x-parent-session-id` for subagents); Goose sends `agent-session-id`.
 */
export const generic: ProviderDef = {
  name: "generic",
  match: () => false,
  identify: (h) => withParent(header(h, "x-session-id", "agent-session-id"), header(h, "x-parent-session-id")),
  // A cache-affinity key (Fireworks, Cloudflare Workers AI); its value is up to the client.
  fallback: (h) => ({ sessionId: header(h, "x-session-affinity") }),
};
