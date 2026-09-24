import { beforeEach, describe, expect, test } from "bun:test";
import { Store } from "../server/store";
import { ANTHROPIC_URL, anthropicTurns, event, geminiTurns, openaiChatTurns, openaiResponsesTurns } from "./fixtures";

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
});

describe("export", () => {
  test("latest and all scopes contain raw request and response bodies", async () => {
    const { exportSession } = await import("../server/export");
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
