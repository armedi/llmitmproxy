import type { IngestEvent } from "../server/types";

let counter = 0;
let clock = 1_790_000_000;

export function event(url: string, reqBody: unknown, respBody: string | unknown, opts: Partial<IngestEvent> = {}): IngestEvent {
  const started = (clock += 5);
  return {
    flow_id: `flow-${++counter}-${Math.random().toString(36).slice(2, 8)}`,
    state: "done",
    method: "POST",
    url,
    started_at: started,
    ended_at: started + 1.5,
    status: 200,
    request_headers: { "content-type": "application/json" },
    response_headers: { "content-type": typeof respBody === "string" ? "text/event-stream" : "application/json" },
    request_body: { text: JSON.stringify(reqBody) },
    response_body: { text: typeof respBody === "string" ? respBody : JSON.stringify(respBody) },
    ...opts,
  };
}

export const sse = (events: [string | null, unknown][]) =>
  events.map(([e, d]) => `${e ? `event: ${e}\n` : ""}data: ${typeof d === "string" ? d : JSON.stringify(d)}\n\n`).join("");

// ---------------- Anthropic (Claude Code–like agent loop) ----------------

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages?beta=true";
const claudeSystem = () => [
  { type: "text", text: `x-anthropic-billing-header: cc_version=2.1.280; cch=${Math.random().toString(36).slice(2, 7)}` },
  { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
  { type: "text", text: "You are an interactive agent that helps users with software engineering tasks.", cache_control: { type: "ephemeral" } },
];
const CLAUDE_TOOLS = [
  { name: "Bash", description: "Run a shell command", input_schema: { type: "object", properties: { command: { type: "string" } } } },
  { name: "Read", description: "Read a file", input_schema: { type: "object", properties: { file_path: { type: "string" } } } },
];

export function anthropicTurns(sessionId = "3f1c2a9e-1111-2222-3333-444455556666", firstPrompt = "list files, then read package.json") {
  const user1 = { role: "user", content: [{ type: "text", text: "<system-reminder>ctx</system-reminder>" }, { type: "text", text: firstPrompt, cache_control: { type: "ephemeral" } }] };
  const a1 = { role: "assistant", content: [{ type: "text", text: "I'll list files." }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] };
  const r1 = { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "package.json\nsrc", cache_control: { type: "ephemeral" } }] };
  const a2 = { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "package.json" } }] };
  const r2 = { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: '{"name":"x"}', cache_control: { type: "ephemeral" } }] };
  // cache_control moves to the newest message each turn, like Claude Code does
  const strip = (m: any) => ({ ...m, content: m.content.map(({ cache_control, ...b }: any) => b) });
  const base = () => ({ model: "claude-sonnet-5", max_tokens: 32000, stream: true, system: claudeSystem(), tools: CLAUDE_TOOLS, metadata: { user_id: `user_abc_account_def_session_${sessionId}` } });

  const turn1Resp = sse([
    ["message_start", { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5", usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 50 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "User wants files." } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "I'll list " } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "files." } }],
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "Bash", input: {} } }],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"comm' } }],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'and":"ls"}' } }],
    ["content_block_stop", { type: "content_block_stop", index: 2 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
  const toolResp = (id: string, name: string, input: unknown) =>
    sse([
      ["message_start", { type: "message_start", message: { id: `msg_${id}`, model: "claude-sonnet-5", usage: { input_tokens: 200, output_tokens: 1 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }],
    ]);
  const finalResp = sse([
    ["message_start", { type: "message_start", message: { id: "msg_3", model: "claude-sonnet-5", usage: { input_tokens: 300, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The package is named **x**." } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } }],
  ]);
  return [
    event(ANTHROPIC_URL, { ...base(), messages: [user1] }, turn1Resp),
    event(ANTHROPIC_URL, { ...base(), messages: [strip(user1), a1, r1] }, toolResp("toolu_2", "Read", { file_path: "package.json" })),
    event(ANTHROPIC_URL, { ...base(), messages: [strip(user1), a1, strip(r1), a2, r2] }, finalResp),
  ];
}

// ---------------- OpenAI Chat Completions ----------------

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export function openaiChatTurns() {
  const sys = { role: "system", content: "You are a helpful assistant." };
  const u1 = { role: "user", content: "What's the weather in Paris?" };
  const tools = [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }];
  const a1 = { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }] };
  const t1 = { role: "tool", tool_call_id: "call_1", content: '{"temp":21}' };
  const chunk = (delta: unknown, finish: string | null = null, extra = {}) => ({ id: "chatcmpl-1", model: "gpt-5.1", choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
  const stream1 = sse([
    [null, chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }] })],
    [null, chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] })],
    [null, chunk({ tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] })],
    [null, chunk({}, "tool_calls")],
    [null, { id: "chatcmpl-1", choices: [], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }],
    [null, "[DONE]"],
  ]);
  const json2 = {
    id: "chatcmpl-2",
    model: "gpt-5.1",
    choices: [{ index: 0, message: { role: "assistant", content: "It's 21°C in Paris." }, finish_reason: "stop" }],
    usage: { prompt_tokens: 80, completion_tokens: 8, total_tokens: 88, prompt_tokens_details: { cached_tokens: 40 } },
  };
  return [
    event(OPENAI_CHAT_URL, { model: "gpt-5.1", stream: true, messages: [sys, u1], tools }, stream1),
    event(OPENAI_CHAT_URL, { model: "gpt-5.1", messages: [sys, u1, a1, t1], tools }, json2),
  ];
}

// ---------------- OpenAI Responses (Codex-like) ----------------

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export function openaiResponsesTurns() {
  const tools = [{ type: "function", name: "shell", description: "Run shell", parameters: { type: "object" } }];
  const u1 = { type: "message", role: "user", content: [{ type: "input_text", text: "count lines in README" }] };
  const reasoning = { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Use wc." }] };
  const call = { type: "function_call", id: "fc_1", call_id: "call_a", name: "shell", arguments: '{"cmd":"wc -l README.md"}' };
  const out = { type: "function_call_output", call_id: "call_a", output: "42 README.md" };
  const resp1 = { id: "resp_1", model: "gpt-5.1-codex", status: "completed", output: [reasoning, call], usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 0 } } };
  const stream1 = sse([
    ["response.created", { type: "response.created", response: { id: "resp_1", model: "gpt-5.1-codex", status: "in_progress", output: [] } }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: reasoning }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 1, item: call }],
    ["response.completed", { type: "response.completed", response: resp1 }],
  ]);
  const msg = { type: "message", role: "assistant", content: [{ type: "output_text", text: "README has 42 lines." }] };
  const stream2 = sse([
    ["response.created", { type: "response.created", response: { id: "resp_2", model: "gpt-5.1-codex" } }],
    ["response.output_text.delta", { type: "response.output_text.delta", output_index: 0, delta: "README has 42 lines." }],
    ["response.completed", { type: "response.completed", response: { id: "resp_2", model: "gpt-5.1-codex", status: "completed", output: [msg], usage: { input_tokens: 160, output_tokens: 8 } } }],
  ]);
  const base = { model: "gpt-5.1-codex", instructions: "You are Codex, a coding agent.", tools, stream: true };
  return {
    full: [
      event(OPENAI_RESPONSES_URL, { ...base, input: [u1] }, stream1),
      event(OPENAI_RESPONSES_URL, { ...base, input: [u1, reasoning, call, out] }, stream2),
    ],
    chained: [
      event(OPENAI_RESPONSES_URL, { ...base, input: [u1] }, stream1),
      event(OPENAI_RESPONSES_URL, { ...base, previous_response_id: "resp_1", input: [out] }, stream2),
    ],
  };
}

// ---------------- Codex over WebSocket (as the addon re-encodes it) ----------------

const CODEX_WS_URL = "https://chatgpt.com/backend-api/codex/responses";

/** A prewarm (`generate: false`) and one real turn, with tools sent as an `additional_tools` input item. */
export function codexWebSocketTurns(sessionId = "01a0d74e-cada-72d1-97d7-45d11814610d") {
  const headers = { "session-id": sessionId, "thread-id": sessionId, "user-agent": "codex-tui/0.157.0 (Mac OS 26.6.0; arm64)" };
  const tools = (id: string) => ({
    type: "additional_tools",
    id,
    role: "developer",
    tools: [
      { type: "namespace", name: "functions", description: "", tools: [{ type: "custom", name: "exec", description: "Run JavaScript", format: { type: "grammar" } }] },
      { type: "namespace", name: "clock", description: "", tools: [{ type: "function", name: "sleep", parameters: { type: "object" } }] },
    ],
  });
  const dev = { type: "message", role: "developer", content: [{ type: "input_text", text: "You are Codex, an agent based on GPT-6." }] };
  const env = { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>" }] };
  const hi = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };
  const base = { model: "gpt-6-luna", tool_choice: "auto", store: false, stream: true, prompt_cache_key: sessionId };
  const extras = (id: string): [string, unknown][] => [
    ["codex.rate_limits", { type: "codex.rate_limits" }],
    ["responsesapi.websocket_timing", { type: "responsesapi.websocket_timing", timing_metrics: { response_id: id } }],
  ];
  const msg = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi! What can I help you with?" }] };
  const prewarm = sse([
    ...extras("resp_w0"),
    ["response.completed", { type: "response.completed", response: { id: "resp_w0", model: "gpt-6-luna", status: "completed", output: [], usage: { input_tokens: 1000, output_tokens: 0 } } }],
  ]);
  const turn = sse([
    ...extras("resp_w1"),
    ["response.created", { type: "response.created", response: { id: "resp_w1", model: "gpt-6-luna", output: [] } }],
    ["response.output_text.delta", { type: "response.output_text.delta", output_index: 0, delta: "Hi! What can I help you with?" }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: msg }],
    // Codex's server leaves the output out of the completed event.
    ["response.completed", { type: "response.completed", response: { id: "resp_w1", model: "gpt-6-luna", status: "completed", output: [], usage: { input_tokens: 1200, output_tokens: 13, input_tokens_details: { cached_tokens: 800 } } } }],
  ]);
  return [
    event(CODEX_WS_URL, { ...base, generate: false, input: [tools("at_1"), dev] }, prewarm, { request_headers: headers }),
    event(CODEX_WS_URL, { ...base, input: [tools("at_2"), dev, env, hi] }, turn, { request_headers: headers }),
  ];
}

/** Codex's title thread: its own session id, marked only by `thread_source` in the turn metadata. */
export function codexTitleThread(threadId = "01a0d75b-4acb-79b2-9543-154a31fbce75") {
  const headers = { "session-id": threadId, "thread-id": threadId, "user-agent": "codex-tui/0.157.0 (Mac OS 26.6.0; arm64)" };
  const client_metadata = { "x-codex-turn-metadata": JSON.stringify({ session_id: threadId, thread_id: threadId, thread_source: "thread_title" }) };
  const dev = { type: "message", role: "developer", content: [{ type: "input_text", text: "You are Codex, an agent based on GPT-5." }] };
  const ask = { type: "message", role: "user", content: [{ type: "input_text", text: "Generate a concise, single-line task title.\n\nUser prompt:\nhi" }] };
  const base = { model: "gpt-5.6-luna", stream: true, prompt_cache_key: threadId, client_metadata };
  const done = (id: string, output: unknown[]) =>
    sse([["response.completed", { type: "response.completed", response: { id, model: "gpt-5.6-luna", status: "completed", output, usage: { input_tokens: 50, output_tokens: 4 } } }]]);
  const title = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Greet the user" }] };
  return [
    event(CODEX_WS_URL, { ...base, generate: false, input: [dev] }, done("resp_t0", []), { request_headers: headers }),
    event(CODEX_WS_URL, { ...base, input: [dev, ask] }, done("resp_t1", [title]), { request_headers: headers }),
  ];
}

// ---------------- Gemini ----------------

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse";

export function geminiTurns() {
  const tools = [{ functionDeclarations: [{ name: "search_docs", description: "Search docs", parameters: { type: "object" } }] }];
  const systemInstruction = { parts: [{ text: "You are a docs assistant." }] };
  const u1 = { role: "user", parts: [{ text: "How do I configure retries?" }] };
  const m1 = { role: "model", parts: [{ functionCall: { name: "search_docs", args: { q: "retries" } } }] };
  const f1 = { role: "user", parts: [{ functionResponse: { name: "search_docs", response: { result: "Set maxRetries" } } }] };
  const stream1 = sse([[null, { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "search_docs", args: { q: "retries" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5, totalTokenCount: 45 }, modelVersion: "gemini-3-pro" }]]);
  const stream2 = sse([
    [null, { candidates: [{ content: { role: "model", parts: [{ text: "Thinking about config", thought: true }] } }] }],
    [null, { candidates: [{ content: { role: "model", parts: [{ text: "Set `maxRetries` " }] } }] }],
    [null, { candidates: [{ content: { role: "model", parts: [{ text: "in your config." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 12, thoughtsTokenCount: 30, totalTokenCount: 112 } }],
  ]);
  return [
    event(GEMINI_URL, { contents: [u1], systemInstruction, tools }, stream1),
    event(GEMINI_URL, { contents: [u1, m1, f1], systemInstruction, tools }, stream2),
  ];
}
