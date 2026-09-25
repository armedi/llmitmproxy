import { header, hostIs, withParent } from "./helpers";
import type { ProviderDef } from "./types";

/** The Kilo Code gateway. */
export const kilo: ProviderDef = {
  name: "kilo",
  match: hostIs("kilocode.ai", "kilo.ai"),
  identify: (h) => withParent(header(h, "x-kilocode-taskid"), header(h, "x-kilocode-parent-taskid"), header(h, "x-kilocode-mode")),
};
