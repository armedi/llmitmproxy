import { header, type Headers } from "./providers/types";

/**
 * The agent or app that sent a request (Claude Code, Codex, …), as opposed to the API
 * format it spoke. Detected from the user agent and client-specific headers.
 */
interface ClientRule {
  name: string;
  test: (h: Headers, ua: string) => boolean;
}

const has = (h: Headers, ...names: string[]) => header(h, ...names) !== undefined;

const RULES: ClientRule[] = [
  { name: "claude-code", test: (h, ua) => /^claude-cli\//i.test(ua) || has(h, "x-claude-code-session-id") },
  { name: "codex", test: (h, ua) => /^codex/i.test(ua) || /^codex/i.test(header(h, "originator") ?? "") },
  { name: "gemini-cli", test: (_, ua) => /^GeminiCLI\//i.test(ua) || /gemini-cli/i.test(ua) },
  { name: "opencode", test: (h, ua) => /^opencode\//i.test(ua) || has(h, "x-opencode-session") },
  { name: "kilo", test: (h, ua) => /kilo-?code/i.test(ua) || has(h, "x-kilocode-taskid") },
  { name: "roo", test: (_, ua) => /roo-?code/i.test(ua) },
  { name: "cline", test: (h, ua) => /^cline\//i.test(ua) || has(h, "x-task-id") },
  { name: "codebuddy", test: (h, ua) => /codebuddy/i.test(ua) || has(h, "x-conversation-id") },
  { name: "mimo", test: (h, ua) => /^mimocode\//i.test(ua) || has(h, "x-mimo-source") },
  { name: "zed", test: (h, ua) => /^Zed\//.test(ua) || has(h, "x-zed-version") },
  { name: "cursor", test: (_, ua) => /cursor/i.test(ua) },
  { name: "aider", test: (_, ua) => /aider/i.test(ua) },
  { name: "crush", test: (_, ua) => /^crush\//i.test(ua) },
  { name: "goose", test: (_, ua) => /goose/i.test(ua) },
];

export function detectClient(headers: Headers): string | null {
  const ua = header(headers, "user-agent") ?? "";
  return RULES.find((r) => r.test(headers, ua))?.name ?? null;
}
