import { header, hostIs } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/** Portkey traces group the calls of one workflow. */
export const portkey: ProviderDef = {
  name: "portkey",
  match: hostIs("portkey.ai"),
  identify: (h) => ({ sessionId: header(h, "x-portkey-trace-id") }),
};
