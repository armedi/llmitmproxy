import { header, hostIs } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/** xAI's conversation id for sticky routing on Chat Completions. */
export const xai: ProviderDef = {
  name: "xai",
  match: hostIs("api.x.ai"),
  identify: (h) => ({ sessionId: header(h, "x-grok-conv-id") }),
};
