import { hostIs, str } from "./helpers";
import type { ProviderDef } from "./types";

export const google: ProviderDef = {
  name: "google",
  match: hostIs("generativelanguage.googleapis.com", "cloudcode-pa.googleapis.com", "aiplatform.googleapis.com"),
  identify: (_h, body) => ({
    // Gemini CLI via Code Assist; `user_prompt_id` is `<session>########<n>`.
    sessionId: str(body?.request?.session_id) ?? str(body?.user_prompt_id)?.split("########")[0],
  }),
};
