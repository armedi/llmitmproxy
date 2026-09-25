import { header, hostIs } from "./helpers";
import type { ProviderDef } from "./types";

/** Portkey traces group the calls of one workflow. */
export const portkey: ProviderDef = {
  name: "portkey",
  match: hostIs("portkey.ai"),
  identify: (h) => ({ sessionId: header(h, "x-portkey-trace-id") }),
};
