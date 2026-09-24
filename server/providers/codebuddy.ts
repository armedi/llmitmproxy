import { header, hostIs, withParent, type ProviderDef } from "./types";

/** Tencent CodeBuddy Code and its gateways. Subagents get their own conversation pointing to the parent's. */
export const codebuddy: ProviderDef = {
  name: "codebuddy",
  match: hostIs("codebuddy.ai", "codebuddy.cn", "copilot.tencent.com"),
  identify: (h) => withParent(header(h, "x-conversation-id"), header(h, "x-parent-conversation-id"), header(h, "x-agent-type")),
};
