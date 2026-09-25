import { hostIs, str } from "./helpers.server";
import type { ProviderDef } from "./types.server";

export const google: ProviderDef = {
  name: "google",
  match: hostIs("generativelanguage.googleapis.com", "cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com", "aiplatform.googleapis.com"),
  identify: (_h, body, own) => {
    // Antigravity: `request.sessionId` lasts as long as the CLI process, across conversations.
    // Agent turns name their conversation in `requestId` (`agent/<conversation>/<ts>/<trajectory>/<step>`).
    // Title calls (`checkpoint/<uuid>`) don't, so they stay under the process id.
    const requestId = str(body?.requestId);
    if (own && requestId?.startsWith("agent/")) return { sessionId: requestId.split("/")[1] || str(body?.request?.sessionId) };
    if (own && body?.requestType === "checkpoint") return { sessionId: str(body?.request?.sessionId), agentName: "title", sideCall: true };
    // Gemini CLI via Code Assist; `user_prompt_id` is `<session>########<n>`.
    return { sessionId: str(body?.request?.session_id) ?? str(body?.request?.sessionId) ?? str(body?.user_prompt_id)?.split("########")[0] };
  },
};
