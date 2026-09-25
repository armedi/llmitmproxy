import { header, hostIs } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/** MiniMax, and MiniMax Code (Mavis), which sends its session header to every provider. */
export const minimax: ProviderDef = {
  name: "minimax",
  match: hostIs("minimax.io", "minimaxi.com"),
  // `x-mavis-agent-id` names a persona (default `main`), not a subagent, so it is not read.
  identify: (h) => ({ sessionId: header(h, "x-mavis-session-id") }),
};
