import { header, hostIs, type ProviderDef } from "./types";

/** Cline's own billing provider. */
export const cline: ProviderDef = {
  name: "cline",
  match: hostIs("cline.bot"),
  identify: (h) => ({ sessionId: header(h, "x-task-id") }),
};
