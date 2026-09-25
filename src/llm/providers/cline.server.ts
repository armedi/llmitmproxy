import { header, hostIs } from "./helpers.server";
import type { ProviderDef } from "./types.server";

/** Cline's own billing provider. */
export const cline: ProviderDef = {
  name: "cline",
  match: hostIs("cline.bot"),
  identify: (h) => ({ sessionId: header(h, "x-task-id") }),
};
