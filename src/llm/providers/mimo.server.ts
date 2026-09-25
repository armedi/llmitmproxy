import { header, hostIs, withParent } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/**
 * Xiaomi MiMo. MiMo Code is an opencode fork that declares its session only as
 * `x-session-affinity`, which is otherwise just a cache key, so it is trusted only from MiMo Code.
 */
export const mimo: ProviderDef = {
  name: "mimo",
  match: hostIs("xiaomimimo.com"),
  identify: (h) =>
    header(h, "x-mimo-source") || /^mimocode\//i.test(header(h, "user-agent") ?? "")
      ? withParent(header(h, "x-session-affinity"), header(h, "x-parent-session-id"))
      : {},
};
