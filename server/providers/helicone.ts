import { header, hostIs, type ProviderDef } from "./types";

/** Helicone sessions. `Helicone-Session-Path` (`/parent/child`) places a request in the session tree. */
export const helicone: ProviderDef = {
  name: "helicone",
  match: hostIs("helicone.ai"),
  identify: (h) => {
    const sessionId = header(h, "helicone-session-id");
    const path = header(h, "helicone-session-path")?.replace(/^\/+|\/+$/g, "");
    if (!sessionId || !path?.includes("/")) return { sessionId };
    return { sessionId, agentId: path, agentName: path.split("/").pop() };
  },
};
