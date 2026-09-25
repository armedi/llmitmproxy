import { describe, expect, test } from "bun:test";
import { identify } from "../server/providers";

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const OPENAI = "https://api.openai.com/v1/responses";
const CODEX = "https://chatgpt.com/backend-api/codex/responses";
const GATEWAY = "https://llm.example.com/v1/chat/completions";

describe("anthropic", () => {
  test("Claude Code header wins over metadata.user_id", () => {
    const body = { metadata: { user_id: JSON.stringify({ device_id: "d", session_id: "from-body" }) } };
    expect(identify(ANTHROPIC, { "x-claude-code-session-id": "from-header" }, body)).toEqual({ sessionId: "from-header" });
    expect(identify(ANTHROPIC, {}, body).sessionId).toBe("from-body");
    expect(identify(ANTHROPIC, {}, { metadata: { user_id: "user_x_account_y_session_3f1c2a9e-1111" } }).sessionId).toBe("3f1c2a9e-1111");
  });

  test("Claude Code subagent", () => {
    const h = { "x-claude-code-session-id": "s", "x-claude-code-agent-id": "a1", "x-claude-code-agent-type": "Explore" };
    expect(identify(ANTHROPIC, h, {})).toEqual({ sessionId: "s", agentId: "a1", agentName: "Explore" });
  });

  test("Claude Code through a gateway is still recognized", () => {
    expect(identify(GATEWAY, { "x-claude-code-session-id": "s" }, {}).sessionId).toBe("s");
  });
});

describe("openai", () => {
  test("Codex root thread, subagent thread and older header", () => {
    expect(identify(CODEX, { "session-id": "root", "thread-id": "root" }, {})).toEqual({ sessionId: "root" });
    expect(identify(CODEX, { "session-id": "root", "thread-id": "t2", "x-openai-subagent": "review" }, {})).toEqual({
      sessionId: "root",
      agentId: "t2",
      agentName: "review",
    });
    expect(identify(OPENAI, { session_id: "old" }, {}).sessionId).toBe("old");
  });

  test("prompt_cache_key is only a fallback", () => {
    expect(identify(OPENAI, {}, { prompt_cache_key: "pck" }).sessionId).toBe("pck");
    expect(identify(OPENAI, { "x-session-id": "declared" }, { prompt_cache_key: "pck" }).sessionId).toBe("declared");
  });
});

describe("google", () => {
  test("Gemini CLI session in the Code Assist body", () => {
    const url = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent";
    expect(identify(url, {}, { request: { session_id: "g1" } }).sessionId).toBe("g1");
    expect(identify(url, {}, { user_prompt_id: "g2########3" }).sessionId).toBe("g2");
  });
});

describe("routers and generic conventions", () => {
  test("opencode Zen links subagents to the parent session", () => {
    const url = "https://opencode.ai/zen/v1/chat/completions";
    expect(identify(url, { "x-opencode-session": "ses_a" }, {})).toEqual({ sessionId: "ses_a" });
    expect(identify(url, { "x-opencode-session": "ses_b", "x-parent-session-id": "ses_a" }, {})).toEqual({
      sessionId: "ses_a",
      agentId: "ses_b",
      agentName: undefined,
    });
  });

  test("generic headers from opencode, Crush, Pi and Goose", () => {
    expect(identify(GATEWAY, { "x-session-id": "c1" }, {}).sessionId).toBe("c1");
    expect(identify(GATEWAY, { "x-session-affinity": "c2" }, {}).sessionId).toBe("c2");
    expect(identify(GATEWAY, { "x-session-affinity": "affinity", "x-session-id": "declared" }, {}).sessionId).toBe("declared");
    expect(identify(GATEWAY, { "agent-session-id": "20260924_1" }, {}).sessionId).toBe("20260924_1");
    expect(identify(GATEWAY, { "x-session-id": "ses_b", "x-parent-session-id": "ses_a" }, {})).toMatchObject({ sessionId: "ses_a", agentId: "ses_b" });
  });

  test("OpenRouter body session_id wins over its header", () => {
    const url = "https://openrouter.ai/api/v1/chat/completions";
    expect(identify(url, { "x-session-id": "h" }, { session_id: "b" }).sessionId).toBe("b");
    expect(identify(url, { "x-session-id": "h" }, {}).sessionId).toBe("h");
  });

  test("Helicone session path marks children", () => {
    const url = "https://oai.helicone.ai/v1/chat/completions";
    expect(identify(url, { "helicone-session-id": "hs", "helicone-session-path": "/root" }, {})).toEqual({ sessionId: "hs" });
    expect(identify(url, { "helicone-session-id": "hs", "helicone-session-path": "/root/search" }, {})).toEqual({
      sessionId: "hs",
      agentId: "root/search",
      agentName: "search",
    });
  });

  test("LiteLLM, Portkey and xAI", () => {
    expect(identify(GATEWAY, { "x-litellm-session-id": "l1" }, {}).sessionId).toBe("l1");
    expect(identify(GATEWAY, {}, { litellm_session_id: "l2" }).sessionId).toBe("l2");
    expect(identify("https://api.portkey.ai/v1/chat/completions", { "x-portkey-trace-id": "p1" }, {}).sessionId).toBe("p1");
    expect(identify("https://api.x.ai/v1/chat/completions", { "x-grok-conv-id": "x1" }, {}).sessionId).toBe("x1");
  });

  test("Qwen Code on DashScope", () => {
    const url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    expect(identify(url, {}, { metadata: { sessionId: "q1" } }).sessionId).toBe("q1");
    expect(identify(url, {}, { prompt_cache_key: "qwen-code:q2:sys" }).sessionId).toBe("q2");
  });

  test("Chinese providers and their coding tools", () => {
    const kimi = "https://api.kimi.com/coding/v1/chat/completions";
    expect(identify(kimi, {}, { prompt_cache_key: "k1" }).sessionId).toBe("k1");
    expect(identify(ANTHROPIC, {}, { metadata: { user_id: "3f1c2a9e-1111-2222-3333-444455556666" } }).sessionId).toBe("3f1c2a9e-1111-2222-3333-444455556666");
    expect(identify(ANTHROPIC, {}, { metadata: { user_id: "end-user-42" } })).toEqual({});

    expect(identify("https://api.minimax.io/anthropic/v1/messages", { "x-mavis-session-id": "m1", "x-mavis-agent-id": "main" }, {})).toEqual({ sessionId: "m1" });

    expect(identify("https://www.codebuddy.ai/v2/chat/completions", { "x-conversation-id": "c-child", "x-parent-conversation-id": "c-root", "x-agent-type": "subagent" }, {})).toEqual({
      sessionId: "c-root",
      agentId: "c-child",
      agentName: "subagent",
    });

    const mimo = "https://api.xiaomimimo.com/v1/chat/completions";
    expect(identify(mimo, { "x-session-affinity": "ses_b", "x-parent-session-id": "ses_a", "x-mimo-source": "mimocode-cli" }, {})).toMatchObject({ sessionId: "ses_a", agentId: "ses_b" });
    // Without MiMo Code's marker the affinity key stays a weak fallback, with no subagent link.
    expect(identify(mimo, { "x-session-affinity": "ses_b", "x-parent-session-id": "ses_a" }, {})).toEqual({ sessionId: "ses_b" });

    expect(identify("https://dashscope-intl.aliyuncs.com/api/v1/apps/app1/completion", {}, { input: { session_id: "d1" } }).sessionId).toBe("d1");
    expect(identify("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {}, { context_id: "ctx-1" }).sessionId).toBe("ctx-1");
  });

  test("host-only rules stay on their hosts", () => {
    // A prompt cache key is only a declared session on Kimi; elsewhere it is the weak fallback.
    expect(identify(OPENAI, { "x-session-id": "declared" }, { prompt_cache_key: "pck" }).sessionId).toBe("declared");
    expect(identify(GATEWAY, {}, { context_id: "ctx-1" })).toEqual({});
  });

  test("Zed thread id; requests without a prompt id are side calls", () => {
    const url = "https://cloud.zed.dev/completions";
    expect(identify(url, {}, { thread_id: "t1", prompt_id: "p1" })).toEqual({ sessionId: "t1" });
    expect(identify(url, {}, { thread_id: "t1" })).toEqual({ sessionId: "t1", sideCall: true });
  });

  test("nothing declared", () => {
    expect(identify(GATEWAY, { "x-client-request-id": "per-request" }, { messages: [] })).toEqual({});
  });
});
