import { header, hostIs, withParent } from "./helpers";
import type { ProviderDef } from "./types";

/** OpenCode Zen and Go. opencode (and Goose, Pi) send `x-opencode-session` here. */
export const opencode: ProviderDef = {
  name: "opencode",
  match: hostIs("opencode.ai"),
  identify: (h) => withParent(header(h, "x-opencode-session"), header(h, "x-parent-session-id")),
};
