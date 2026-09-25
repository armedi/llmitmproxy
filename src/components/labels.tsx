import type { Session } from "../data/api";

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  gemini: "Gemini",
  unknown: "Unknown",
};

export function kindLabel(s: Session) {
  if (s.agent_id) return s.agent_name ?? "subagent";
  return s.latest_msg_count > 2 ? "thread" : "side call";
}

const CLIENT_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  antigravity: "Antigravity",
  opencode: "opencode",
  cline: "Cline",
  kilo: "Kilo",
  roo: "Roo",
  cursor: "Cursor",
  aider: "Aider",
  codebuddy: "CodeBuddy",
  mimo: "MiMo",
  crush: "Crush",
  goose: "Goose",
};

/** The agent app, in its own color. */
export function ClientTag({ client }: { client: string | null }) {
  if (!client) return <span className="client-tag c-unknown">unknown</span>;
  return <span className={`client-tag c-${client}`}>{CLIENT_LABEL[client] ?? client}</span>;
}
