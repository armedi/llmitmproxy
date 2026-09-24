import { describe, expect, test } from "bun:test";
import { detectProvider, normalizeRequest, normalizeResponse } from "../server/parsers";
import { anthropicTurns, geminiTurns, openaiChatTurns, openaiResponsesTurns } from "./fixtures";

const parse = (ev: any) => {
  const n = normalizeRequest(ev);
  return { ...n, response: normalizeResponse(n.provider, ev) };
};

describe("anthropic", () => {
  test("session headers win over metadata.user_id; subagent headers are read", () => {
    const [t1] = anthropicTurns();
    const n = normalizeRequest({
      ...t1!,
      request_headers: {
        "x-claude-code-session-id": "1ac7d908-1dcc-43f6-b465-9d9e61433d4e",
        "x-claude-code-agent-id": "a29bb6421b39edd2a",
        "x-claude-code-agent-type": "general-purpose",
      },
    });
    expect(n.sessionId).toBe("1ac7d908-1dcc-43f6-b465-9d9e61433d4e");
    expect(n.agentId).toBe("a29bb6421b39edd2a");
    expect(n.agentName).toBe("general-purpose");
  });

  test("request + streamed response", () => {
    const [t1, , t3] = anthropicTurns();
    const n = parse(t1);
    expect(n.provider).toBe("anthropic");
    expect(n.model).toBe("claude-sonnet-5");
    expect(n.system).toHaveLength(3);
    expect(n.tools.map((t) => t.name)).toEqual(["Bash", "Read"]);
    expect(n.sessionId).toBe("3f1c2a9e-1111-2222-3333-444455556666");
    expect(n.response?.blocks).toEqual([
      { type: "thinking", text: "User wants files." },
      { type: "text", text: "I'll list files." },
      { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
    ]);
    expect(n.response?.stopReason).toBe("tool_use");
    expect(n.response?.usage).toEqual({ input: 100, output: 42, cacheRead: 50, cacheWrite: undefined });

    const n3 = parse(t3);
    expect(n3.messages).toHaveLength(5);
    expect(n3.messages[2]!.content[0]).toMatchObject({ type: "tool_result", toolUseId: "toolu_1" });
    expect(n3.response?.blocks).toEqual([{ type: "text", text: "The package is named **x**." }]);
  });

  test("JSON response and error", () => {
    const t1 = anthropicTurns()[0]!;
    const ok = normalizeResponse("anthropic", {
      ...t1,
      response_headers: { "content-type": "application/json" },
      response_body: { text: JSON.stringify({ id: "m", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 } }) },
    });
    expect(ok?.blocks).toEqual([{ type: "text", text: "hi" }]);
    const err = normalizeResponse("anthropic", {
      ...t1,
      status: 529,
      response_headers: { "content-type": "application/json" },
      response_body: { text: JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }) },
    });
    expect(err?.error).toBe("Overloaded");
  });
});

describe("openai chat", () => {
  test("stream with tool call deltas, then JSON", () => {
    const [t1, t2] = openaiChatTurns();
    const n1 = parse(t1);
    expect(n1.provider).toBe("openai-chat");
    expect(n1.system).toEqual([{ type: "text", text: "You are a helpful assistant." }]);
    expect(n1.messages).toHaveLength(1);
    expect(n1.response?.blocks).toEqual([{ type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } }]);
    expect(n1.response?.usage?.input).toBe(50);
    const n2 = parse(t2);
    expect(n2.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(n2.response?.blocks).toEqual([{ type: "text", text: "It's 21°C in Paris." }]);
    expect(n2.response?.usage?.cacheRead).toBe(40);
    // Cached tokens are reported inside prompt_tokens; input is the uncached part.
    expect(n2.response?.usage?.input).toBe(40);
  });
});

describe("openai responses", () => {
  test("items and completed event", () => {
    const [t1, t2] = openaiResponsesTurns().full;
    const n1 = parse(t1);
    expect(n1.provider).toBe("openai-responses");
    expect(n1.system).toEqual([{ type: "text", text: "You are Codex, a coding agent." }]);
    expect(n1.response?.blocks).toEqual([
      { type: "thinking", text: "Use wc.", redacted: false },
      { type: "tool_use", id: "call_a", name: "shell", input: { cmd: "wc -l README.md" } },
    ]);
    const n2 = parse(t2);
    expect(n2.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(n2.response?.blocks).toEqual([{ type: "text", text: "README has 42 lines." }]);
  });

  test("previous_response_id is captured", () => {
    const [, t2] = openaiResponsesTurns().chained;
    expect(normalizeRequest(t2!).previousResponseId).toBe("resp_1");
  });
});

describe("gemini", () => {
  test("stream merges text chunks, keeps thoughts separate", () => {
    const [t1, t2] = geminiTurns();
    const n1 = parse(t1);
    expect(n1.provider).toBe("gemini");
    expect(n1.model).toBe("gemini-3-pro");
    expect(n1.stream).toBe(true);
    expect(n1.response?.blocks).toEqual([{ type: "tool_use", id: undefined, name: "search_docs", input: { q: "retries" } }]);
    const n2 = parse(t2);
    expect(n2.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(n2.response?.blocks).toEqual([
      { type: "thinking", text: "Thinking about config" },
      { type: "text", text: "Set `maxRetries` in your config." },
    ]);
    expect(n2.response?.usage?.reasoning).toBe(30);
  });
});

test("provider detection falls back to body shape", () => {
  expect(detectProvider("https://gw.local/llm/proxy", { messages: [], system: "x", max_tokens: 1 })).toBe("anthropic");
  expect(detectProvider("https://gw.local/llm/proxy", { messages: [{ role: "system", content: "x" }] })).toBe("openai-chat");
  expect(detectProvider("https://gw.local/llm/proxy", { input: "hi" })).toBe("openai-responses");
  expect(detectProvider("https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent", {})).toBe("gemini");
});
