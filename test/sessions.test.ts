import { beforeEach, describe, expect, test } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../src/db/store.server";
import { ANTHROPIC_URL, anthropicTurns, codexTitleThread, codexWebSocketTurns, event, geminiTurns, openaiChatTurns, openaiResponsesTurns, sse } from "./fixtures";

let store: Store;
beforeEach(() => {
  store = new Store(":memory:");
});

const ingestAll = (evs: any[]) => evs.map((e) => store.ingest(e));

describe("session grouping", () => {
  test("growing Claude Code turns form one session; latest is the last turn", () => {
    const turns = anthropicTurns();
    const ids = ingestAll(turns);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.request_count).toBe(3);
    expect(s.latest_request_id).toBe(ids[2]!.requestId);
    expect(s.title).toBe("list files, then read package.json");
    expect(s.input_tokens).toBe(600);
  });

  test("works without an explicit session id (prefix chain only)", () => {
    const turns = anthropicTurns().map((e) => {
      const body = JSON.parse(e.request_body!.text!);
      delete body.metadata;
      return { ...e, request_body: { text: JSON.stringify(body) } };
    });
    ingestAll(turns);
    expect(store.listSessions()).toHaveLength(1);
  });

  test("interleaved parallel sessions stay separate", () => {
    const a = anthropicTurns("aaaaaaaa-0000-0000-0000-000000000001", "task A");
    const b = anthropicTurns("bbbbbbbb-0000-0000-0000-000000000002", "task B");
    ingestAll([a[0], b[0], a[1], b[1], a[2], b[2]]);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.request_count)).toEqual([3, 3]);
    expect(sessions.map((s) => s.title).sort()).toEqual(["task A", "task B"]);
  });

  test("same prompt in two sessions without session ids still splits after divergence", () => {
    const strip = (evs: any[]) =>
      evs.map((e) => {
        const body = JSON.parse(e.request_body.text);
        delete body.metadata;
        return { ...e, request_body: { text: JSON.stringify(body) } };
      });
    const a = strip(anthropicTurns("x", "same"));
    ingestAll(a);
    // A fresh session with the same first prompt starts again from 1 message: it must not join the 5-message session.
    store.ingest(strip(anthropicTurns("y", "same"))[0]);
    expect(store.listSessions()).toHaveLength(2);
  });

  test("rewind / compaction starts a new session", () => {
    const turns = anthropicTurns();
    ingestAll(turns);
    const body = JSON.parse(turns[0]!.request_body!.text!);
    body.messages = [{ role: "user", content: "This session is being continued from a previous conversation. Summary: ..." }];
    store.ingest(event(ANTHROPIC_URL, body, turns[0]!.response_body!.text!));
    expect(store.listSessions()).toHaveLength(2);
  });

  test("a side call under the same session id is its own session, linked to the main one", () => {
    const turns = anthropicTurns();
    const ids = ingestAll(turns);
    const body = JSON.parse(turns[0]!.request_body!.text!);
    body.system = [{ type: "text", text: "You are a file search specialist." }];
    body.messages = [{ role: "user", content: "Find all config files" }];
    const side = store.ingest(event(ANTHROPIC_URL, body, turns[0]!.response_body!.text!));
    expect(store.listSessions()).toHaveLength(2);
    const main = store.getSession(ids[0]!.sessionId)!;
    expect(main.session_id).toBe("3f1c2a9e-1111-2222-3333-444455556666");
    expect(main.parent_id).toBeNull();
    expect(main.child_count).toBe(1);
    expect(store.getSession(side.sessionId)!.parent_id).toBe(main.id);
  });

  test("a Zed title request stays a side call and the next turn continues the thread", () => {
    const URL = "https://cloud.zed.dev/completions?";
    const msg = (role: string, text: string) => ({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
    const tools = [{ type: "function", name: "read_file", parameters: {} }];
    const zed = (input: unknown[], promptId?: string) =>
      event(URL, {
        thread_id: "t1",
        ...(promptId && { prompt_id: promptId }),
        provider: "open_ai",
        model: "gpt-6-luna",
        provider_request: { model: "gpt-6-luna", input, ...(promptId && { instructions: "sys", tools }) },
      }, {});
    const q = msg("user", "what can you do?");
    const a = msg("assistant", "Lots.");
    const turn1 = store.ingest(zed([q], "p1"));
    const title = store.ingest(zed([q, a, msg("user", "Generate a concise 3-7 word title for this conversation")]));
    const turn2 = store.ingest(zed([q, a, msg("user", "show me the files")], "p2"));

    expect(turn2.sessionId).toBe(turn1.sessionId);
    expect(title.sessionId).not.toBe(turn1.sessionId);
    const side = store.getSession(title.sessionId)!;
    expect(side.parent_id).toBe(turn1.sessionId);
    expect(side.agent_name).toBe("side call");
  });

  test("Claude Code message threads: a continuing turn is stitched onto the previous message", () => {
    const hdr = { "content-type": "application/json", "x-claude-code-session-id": "sess-t" };
    const tools = [{ name: "Bash", input_schema: { type: "object" } }];
    const reply = (id: string, content: object) =>
      sse([
        ["message_start", { type: "message_start", message: { id, model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 1 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: content }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_stop", { type: "message_stop" }],
      ]);
    const q = { role: "user", content: [{ type: "text", text: "list files" }] };
    const ids = ingestAll([
      event(ANTHROPIC_URL, { model: "claude-opus-5-5", system: "sys", tools, thread: { type: "create" }, messages: [q] },
        reply("msg_a", { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }), { request_headers: hdr }),
      event(ANTHROPIC_URL, {
        model: "claude-opus-5-5",
        system: "sys",
        thread: { type: "continue", previous_message_id: "msg_a" },
        messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a.txt" }] }],
      }, reply("msg_b", { type: "text", text: "One file." }), { request_headers: hdr }),
    ]);
    expect(ids[1]!.sessionId).toBe(ids[0]!.sessionId);
    const n = store.getRequest(ids[1]!.requestId)!.normalized;
    expect(n.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(n.tools.map((t: any) => t.name)).toEqual(["Bash"]);
  });

  test("retries of the same side call share one side session", () => {
    const url = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
    const title = () =>
      event(url, { requestType: "checkpoint", request: { sessionId: "s", contents: [{ role: "user", parts: [{ text: "hi" }] }] } }, "", { status: 503 });
    const ids = ingestAll([title(), title(), title()]);
    expect(new Set(ids.map((i) => i.sessionId)).size).toBe(1);
    expect(store.getSession(ids[0]!.sessionId)!.request_count).toBe(3);
  });

  test("header session id groups turns even when the tool set changes", () => {
    const hdr = { "x-claude-code-session-id": "sess-1" };
    const turns = anthropicTurns().map((e, i) => {
      const body = JSON.parse(e.request_body!.text!);
      delete body.metadata;
      if (i === 2) body.tools.push({ name: "mcp__new", input_schema: { type: "object" } });
      return { ...e, request_headers: hdr, request_body: { text: JSON.stringify(body) } };
    });
    ingestAll(turns);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.session_id).toBe("sess-1");
    expect(sessions[0]!.request_count).toBe(3);
  });

  test("subagent requests are keyed by agent id and linked to the main session", () => {
    const turns = anthropicTurns();
    const ids = ingestAll(turns);
    const sub = (text: string) => {
      const body = JSON.parse(turns[0]!.request_body!.text!);
      body.messages = [{ role: "user", content: text }];
      return event(ANTHROPIC_URL, body, turns[0]!.response_body!.text!, {
        request_headers: {
          "x-claude-code-session-id": "3f1c2a9e-1111-2222-3333-444455556666",
          "x-claude-code-agent-id": "agent-1",
          "x-claude-code-agent-type": "Explore",
        },
      });
    };
    const a = store.ingest(sub("Find config files"));
    // Different messages (e.g. an auxiliary call made for the subagent) still join by agent id.
    const b = store.ingest(sub("Summarize what you found"));
    expect(b.sessionId).toBe(a.sessionId);
    const s = store.getSession(a.sessionId)!;
    expect(s).toMatchObject({ agent_id: "agent-1", agent_name: "Explore", parent_id: ids[0]!.sessionId, request_count: 2 });

    expect(store.deleteSession(ids[0]!.sessionId).sort()).toEqual([ids[0]!.sessionId, a.sessionId].sort());
    expect(store.listSessions()).toHaveLength(0);
  });


  test("in-body system messages (newer Claude Code) keep their role and still chain", () => {
    const turns = anthropicTurns().map((e, i) => {
      const body = JSON.parse(e.request_body!.text!);
      body.messages.splice(1, 0, { role: "system", content: i === 0 ? [{ type: "text", text: "# Environment", cache_control: { type: "ephemeral" } }] : "# Environment" });
      return { ...e, request_body: { text: JSON.stringify(body) } };
    });
    const ids = ingestAll(turns);
    expect(store.listSessions()).toHaveLength(1);
    expect(store.getRequest(ids[2]!.requestId)!.normalized.messages[1].role).toBe("system");
  });

  test("pending then done updates the same request", () => {
    const [t1] = anthropicTurns();
    const pending = { ...t1!, state: "pending" as const, response_body: null, status: undefined };
    const a = store.ingest(pending);
    expect(store.listSessions()[0]!.pending).toBe(1);
    const b = store.ingest(t1!);
    expect(b.requestId).toBe(a.requestId);
    const s = store.listSessions()[0]!;
    expect(s.pending).toBe(0);
    expect(s.request_count).toBe(1);
    const r = store.getRequest(a.requestId)!;
    expect(r.state).toBe("done");
    expect(r.normalized.response.stopReason).toBe("tool_use");
  });

  test("Antigravity: each conversation is its own session; title calls stay out of them", () => {
    const url = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
    const headers = { "content-type": "application/json", "user-agent": "antigravity/cli/1.2.11 (aidev_client; os_type=darwin)" };
    const tools = [{ functionDeclarations: [{ name: "view_file", parameters: { type: "object" } }] }];
    const prompt = { role: "user", parts: [{ text: "<USER_REQUEST>\nhi\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nlocal time\n</ADDITIONAL_METADATA>" }] };
    const reply = { role: "model", parts: [{ text: "Hello!" }] };
    const next = { role: "user", parts: [{ text: "<USER_REQUEST>\ntell me a story\n</USER_REQUEST>" }] };
    const stream = (text: string) => sse([[null, { response: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] } }]]);
    // `sessionId` is the CLI process; the conversation is only in an agent turn's requestId.
    const body = (requestId: string, request: object) => ({
      requestType: requestId.split("/")[0],
      requestId,
      model: "gemini-3.8-flash",
      request: { ...request, sessionId: "proc" },
    });
    const title = () => event(url, body("checkpoint/x", { contents: [{ role: "user", parts: [{ text: "hi" }] }] }), stream("Greeting"), { request_headers: headers });
    const ids = ingestAll([
      title(),
      event(url, body("agent/conv-1/1/t/1", { contents: [prompt], tools }), stream("Hello!"), { request_headers: headers }),
      event(url, body("agent/conv-1/2/t/3", { contents: [prompt, reply, next], tools }), stream("Once upon a time"), { request_headers: headers }),
      title(),
      event(url, body("agent/conv-2/3/t2/1", { contents: [prompt], tools }), stream("Hello!"), { request_headers: headers }),
    ]);
    const conv1 = store.getSession(ids[1]!.sessionId)!;
    expect(ids[2]!.sessionId).toBe(conv1.id);
    expect(conv1).toMatchObject({ title: "hi", client: "antigravity", session_id: "conv-1", parent_id: null, child_count: 0 });
    expect(store.getSession(ids[4]!.sessionId)).toMatchObject({ session_id: "conv-2", parent_id: null });
    // Both title calls say "hi", so they share one "title" session, belonging to no conversation.
    expect(ids[3]!.sessionId).toBe(ids[0]!.sessionId);
    expect(store.getSession(ids[0]!.sessionId)).toMatchObject({ session_id: "proc", agent_name: "title", request_count: 2 });
  });

  test("openai chat, responses and gemini each group into one session", () => {
    ingestAll(openaiChatTurns());
    ingestAll(openaiResponsesTurns().full);
    ingestAll(geminiTurns());
    const sessions = store.listSessions();
    expect(sessions.map((s) => [s.provider, s.request_count]).sort()).toEqual([
      ["gemini", 2],
      ["openai-chat", 2],
      ["openai-responses", 2],
    ]);
  });

  test("responses previous_response_id chain is stitched into full history", () => {
    const ids = ingestAll(openaiResponsesTurns().chained);
    expect(store.listSessions()).toHaveLength(1);
    const latest = store.getRequest(ids[1]!.requestId)!;
    expect(latest.normalized.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  test("Codex over WebSocket: the prewarm joins its turn, tools come from additional_tools", () => {
    const ids = ingestAll(codexWebSocketTurns());
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.request_count).toBe(2);
    expect(s.latest_request_id).toBe(ids[1]!.requestId);
    expect(s.title).toBe("hi");
    expect(s.input_tokens).toBe(1000 + 400);
    const n = store.getRequest(ids[1]!.requestId)!.normalized;
    expect(n.tools.map((t: any) => t.name)).toEqual(["exec", "clock.sleep"]);
    expect(n.system).toEqual([{ type: "text", text: "You are Codex, an agent based on GPT-6." }]);
    expect(n.messages.map((m: any) => m.role)).toEqual(["user", "user"]);
    expect(n.response.blocks).toEqual([{ type: "text", text: "Hi! What can I help you with?" }]);
  });

  test("Codex's title thread is a standalone side call, prewarm included", () => {
    const ids = ingestAll([...codexWebSocketTurns(), ...codexTitleThread()]);
    expect(store.listSessions()).toHaveLength(2);
    const side = store.getSession(ids[3]!.sessionId)!;
    expect(ids[2]!.sessionId).toBe(side.id);
    expect(side.parent_id).toBeNull();
    expect(side.agent_id).toBe("side:01a0d75b-4acb-79b2-9543-154a31fbce75");
    expect(side.agent_name).toBe("title");
    expect(side.request_count).toBe(2);
    expect(side.title).toMatch(/^Generate a concise/);
  });

  test("a Codex title thread that names its parent thread joins it", () => {
    const [prewarm, turn] = codexWebSocketTurns("root-1");
    const title = codexTitleThread().map((e) => ({ ...e, request_headers: { ...e.request_headers, "x-codex-parent-thread-id": "root-1" } }));
    const ids = ingestAll([prewarm, turn, ...title]);
    const side = store.getSession(ids[3]!.sessionId)!;
    expect(side.parent_id).toBe(ids[1]!.sessionId);
    expect(side.agent_name).toBe("title");
  });
});

describe("export", () => {
  test("latest and all scopes contain raw request and response bodies", async () => {
    const { exportSession } = await import("../src/db/export.server");
    const ids = ingestAll(anthropicTurns());
    const s = store.getSession(ids[0]!.sessionId)!;
    const latest = exportSession(store, s, "latest");
    expect(latest.requests).toHaveLength(1);
    expect(latest.requests[0]!.id).toBe(ids[2]!.requestId);
    expect(latest.requests[0]!.request.body.messages).toHaveLength(5);
    expect(typeof latest.requests[0]!.response.body).toBe("string"); // SSE stays raw
    expect(latest.requests[0]!.response.body).toContain("event: message_start");
    expect(exportSession(store, s, "all").requests.map((r) => r.id)).toEqual(ids.map((i) => i.requestId));
  });
});

describe("requests, cost and clients", () => {
  const pricing = { hash: "t", models: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3 }, "gpt-5.1": { input: 1, output: 8, cacheRead: 0.1 } } };

  test("listRequests carries usage, cost, stop reason and tool calls", () => {
    store = new Store(":memory:", pricing);
    const ids = ingestAll(anthropicTurns().map((e) => ({ ...e, response_started_at: e.started_at + 0.4 })));
    const rows = store.listRequests(ids[0]!.sessionId);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ stop_reason: "tool_use", tool_calls: ["Bash"], model: "claude-sonnet-5" });
    expect(rows[0]!.usage).toMatchObject({ input: 100, cacheRead: 50 });
    expect(rows[0]!.response_started_at).toBe(rows[0]!.started_at + 0.4);
    expect(rows[0]!.cost).toBeCloseTo((100 * 3 + 50 * 0.3 + rows[0]!.usage!.output! * 15) / 1e6);
    const s = store.getSession(ids[0]!.sessionId)!;
    expect(s.cost).toBeCloseTo(rows.reduce((a, r) => a + r.cost!, 0));
    expect(s.unpriced).toBe(0);
    expect(s.last_stop_reason).toBe(rows[2]!.stop_reason);
    expect(s.group_cost).toBeCloseTo(s.cost);
  });

  test("unknown models count as unpriced", () => {
    store = new Store(":memory:", { hash: "none", models: {} });
    const ids = ingestAll(anthropicTurns());
    expect(store.getSession(ids[0]!.sessionId)).toMatchObject({ cost: 0, unpriced: 3 });
  });

  test("openai cached tokens are not double counted in session totals", () => {
    const ids = ingestAll(openaiChatTurns());
    // 50 uncached, then 80 prompt of which 40 cached.
    expect(store.getSession(ids[0]!.sessionId)).toMatchObject({ input_tokens: 90, cache_read_tokens: 40 });
  });

  test("client is detected from the user agent", () => {
    const ids = ingestAll(anthropicTurns().map((e) => ({ ...e, request_headers: { ...e.request_headers, "user-agent": "claude-cli/2.1.0 (external, cli)" } })));
    expect(store.getSession(ids[0]!.sessionId)!.client).toBe("claude-code");
  });

  test("reopening re-parses old usage, backfills clients and recomputes costs", () => {
    const path = `${tmpdir()}/llmitmproxy-test-${Date.now()}.db`;
    try {
      store = new Store(path, pricing);
      const ids = ingestAll(openaiChatTurns().map((e) => ({ ...e, request_headers: { ...e.request_headers, "user-agent": "codex_cli_rs/0.5" } })));
      const sid = ids[0]!.sessionId;
      // Simulate a database written by an older version: prompt counts included cached tokens, no client, no cost.
      store.db.exec(`UPDATE requests SET usage = json_set(usage, '$.input', 80) WHERE id = ${ids[1]!.requestId};
        UPDATE sessions SET input_tokens = 130, client = NULL, cost = 0; UPDATE requests SET cost = NULL;
        UPDATE meta SET value = '1' WHERE key = 'parser_version';`);
      store.db.close();
      store = new Store(path, { ...pricing, hash: "t2" });
      expect(store.getSession(sid)).toMatchObject({ input_tokens: 90, client: "codex" });
      expect(store.getSession(sid)!.cost).toBeGreaterThan(0);
      expect(store.listRequests(sid)[1]!.usage!.input).toBe(40);
    } finally {
      store.db.close();
      for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
    }
  });

  test("reopening after the hash function changed rehashes, so later turns still join", () => {
    const path = `${tmpdir()}/llmitmproxy-test-rehash-${Date.now()}.db`;
    const turns = anthropicTurns();
    try {
      store = new Store(path, pricing);
      const first = ingestAll(turns.slice(0, 2));
      // Simulate a database written with another hash function (Bun.hash).
      store.db.exec(`UPDATE requests SET msg_hashes = (SELECT json_group_array('old' || value) FROM json_each(msg_hashes));
        UPDATE sessions SET fingerprint = 'old'; UPDATE meta SET value = 'wyhash' WHERE key = 'hash_version';`);
      store.db.close();
      store = new Store(path, pricing);
      const [last] = ingestAll(turns.slice(2));
      expect(last!.sessionId).toBe(first[0]!.sessionId);
    } finally {
      store.db.close();
      for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
    }
  });
});
