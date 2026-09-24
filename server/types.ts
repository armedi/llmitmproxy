export type Provider = "anthropic" | "openai-chat" | "openai-responses" | "gemini" | "unknown";

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; redacted?: boolean }
  | { type: "tool_use"; id?: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId?: string; name?: string; content: Block[]; isError?: boolean }
  | { type: "image"; mediaType?: string; source?: string }
  | { type: "raw"; label?: string; data: unknown };

export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: Block[];
}

export interface ToolDef {
  name: string;
  description?: string;
  schema?: unknown;
}

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  total?: number;
}

export interface NormalizedResponse {
  id?: string;
  model?: string;
  blocks: Block[];
  stopReason?: string;
  usage?: Usage;
  error?: string;
}

export interface Normalized {
  provider: Provider;
  model?: string;
  stream?: boolean;
  params: Record<string, unknown>;
  system: Block[];
  tools: ToolDef[];
  messages: Message[];
  response?: NormalizedResponse;
  /** The agent's own session id, as sent in a header or the request body. */
  sessionId?: string;
  /** Id of the subagent within that session, when the client sends one. */
  agentId?: string;
  /** The subagent's type or name, when the client sends one. */
  agentName?: string;
  /** OpenAI Responses previous_response_id, used to chain sessions. */
  previousResponseId?: string;
}

export interface IngestEvent {
  flow_id: string;
  state: "pending" | "done" | "error";
  method: string;
  url: string;
  started_at: number;
  ended_at?: number;
  status?: number;
  error?: string;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  request_body?: { text?: string; base64?: string } | null;
  response_body?: { text?: string; base64?: string } | null;
}
