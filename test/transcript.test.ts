import { describe, expect, test } from "bun:test";
import type { RequestSummary } from "../web/api";
import { patchLines, replacementDiff, toolDiff } from "../web/transcript/diff";
import { boundaryOf, buildItems, focusItems, itemText } from "../web/transcript/items";
import { turnsByIndex, vitals } from "../web/transcript/stats";
import { category, commandOf, summarize } from "../web/transcript/tools";
import type { Normalized } from "../server/types";

const thread = (): Normalized => ({
  provider: "anthropic",
  params: {},
  system: [],
  tools: [],
  messages: [
    { role: "user", content: [{ type: "text", text: "<system-reminder>ctx</system-reminder>" }, { type: "text", text: "fix the bug" }] },
    { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a/b/c/d.ts" } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: [{ type: "text", text: "one\ntwo" }] }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "d.ts", old_string: "a\nb", new_string: "a\nc\nd" } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "t2", content: [{ type: "text", text: "ok" }] }, { type: "text", text: "<system-reminder>todo</system-reminder>" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "bun test" } }, { type: "tool_use", id: "t4", name: "Grep", input: { pattern: "x" } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "t3", content: [{ type: "text", text: "pass" }] }, { type: "tool_result", toolUseId: "t4", content: [] }] },
    { role: "user", content: [{ type: "text", text: "<command-name>/clear</command-name>\n<command-args></command-args>" }] },
  ],
  response: { blocks: [{ type: "text", text: "Fixed." }] },
});

describe("display items", () => {
  test("results pair with calls, tool-only runs group, reminders become boundaries", () => {
    const { items, results } = buildItems(thread());
    expect(results.size).toBe(4);
    expect(items.map((i) => i.kind)).toEqual(["message", "message", "tools", "boundary", "message"]);
    const group = items[2]!;
    if (group.kind !== "tools") throw new Error();
    expect(group.calls).toBe(3);
    // The reminder injected between tool calls stays inside the group.
    expect(group.items.map((i) => i.kind)).toEqual(["message", "boundary", "message"]);
    expect(items[3]).toMatchObject({ kind: "boundary", boundaries: [{ tag: "command-name", label: "Slash command" }] });
    expect(items[4]).toMatchObject({ kind: "message", response: true });
  });

  test("unpaired results stay visible", () => {
    const n = thread();
    n.messages[1]!.content.pop(); // drop tool_use t1
    const { items } = buildItems(n);
    expect(items.some((i) => i.kind === "message" && i.role === "tool")).toBe(true);
  });

  test("focused mode keeps prompts and final answers", () => {
    const { items } = buildItems(thread());
    expect(focusItems(items).map((i) => (i.kind === "message" ? `${i.role}#${i.index}` : i.kind))).toEqual(["user#0", "assistant#8"]);
  });

  test("search text includes tool input and paired output", () => {
    const { items, results } = buildItems(thread());
    const text = itemText(items[2]!, results);
    expect(text).toContain("bun test");
    expect(text).toContain("pass");
  });
});

describe("boundaries", () => {
  test("tag-only text is a boundary, mixed text is not", () => {
    expect(boundaryOf("<system-reminder>\nhi\n</system-reminder>")).toEqual({ tag: "system-reminder", label: "System reminder", nodes: ["hi"], body: "hi" });
    expect(boundaryOf("<command-name>/model</command-name>\n<command-args></command-args>")).toMatchObject({ label: "Slash command", body: "/model" });
    expect(boundaryOf("<system-reminder>x</system-reminder> and more")).toBeUndefined();
    expect(boundaryOf("plain")).toBeUndefined();
    // Unknown tags are the client's own prompt markup, shown as the user's text.
    expect(boundaryOf("<USER_REQUEST>\nhi\n</USER_REQUEST>\n<ADDITIONAL_METADATA>t</ADDITIONAL_METADATA>")).toBeUndefined();
  });
});

describe("tool summaries", () => {
  test.each([
    ["Bash", { command: "ls -la\nmore" }, "$ ls -la"],
    ["shell", { command: ["bash", "-lc", "wc -l README.md"] }, "$ wc -l README.md"],
    ["Read", { file_path: "/Users/x/proj/src/app.ts" }, "…/proj/src/app.ts"],
    ["Edit", { file_path: "a.ts", old_string: "x", new_string: "y\nz" }, "a.ts (+2 −1)"],
    ["Write", { file_path: "a.ts", content: "1\n2\n3\n" }, "a.ts (+3)"],
    ["Grep", { pattern: "TODO", path: "src" }, "TODO  in src"],
    ["TodoWrite", { todos: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }] }, "1/2 done → b"],
    ["Task", { description: "Explore config", prompt: "…" }, "Explore config"],
    ["apply_patch", { input: "*** Begin Patch\n*** Update File: src/x.ts\n@@\n-a\n+b\n+c\n*** End Patch" }, "src/x.ts (+2 −1)"],
    ["mcp__github__get_issue", { owner: "o", repo: "r" }, "o"],
  ])("%s", (name, input, expected) => {
    expect(summarize(name, input)).toBe(expected);
  });

  test("categories", () => {
    expect(category("Bash")).toBe("bash");
    expect(category("exec_command")).toBe("bash");
    expect(category("MultiEdit")).toBe("edit");
    expect(category("mcp__x__y")).toBe("mcp");
    expect(category("Custom")).toBe("other");
    expect(commandOf({ cmd: "echo hi" })).toBe("echo hi");
  });
});

describe("diffs", () => {
  test("replacement keeps shared lines as context", () => {
    expect(replacementDiff("a\nb\nz", "a\nc\nd\nz").map((l) => l.kind)).toEqual(["hunk", "ctx", "del", "add", "add", "ctx"]);
  });
  test("write is all additions; patches are classified", () => {
    expect(toolDiff("Write", { content: "x\ny" })!.filter((l) => l.kind === "add")).toHaveLength(2);
    expect(patchLines("*** Update File: a\n@@\n-a\n+b\n c").map((l) => l.kind)).toEqual(["file", "hunk", "del", "add", "ctx"]);
    expect(toolDiff("Bash", { command: "ls" })).toBeUndefined();
  });
});

const req = (id: number, over: Partial<RequestSummary>): RequestSummary => ({
  id,
  state: "done",
  provider: "anthropic",
  model: "m",
  url: "",
  status: 200,
  started_at: id * 10,
  response_started_at: id * 10 + 0.5,
  ended_at: id * 10 + id,
  msg_count: id,
  error: null,
  usage: { input: 10, cacheRead: 90, output: 5 },
  cost: 0.01,
  stop_reason: "tool_use",
  tool_calls: ["Bash"],
  ...over,
});

describe("stats", () => {
  test("turns map requests to the message they produced; retries win", () => {
    const rs = [req(1, {}), req(2, { msg_count: 3 }), req(3, { msg_count: 3 }), req(4, { msg_count: 9 })];
    const t = turnsByIndex(rs, 5);
    expect(t.get(3)?.request.id).toBe(3);
    expect(t.get(3)?.ordinal).toBe(3);
    expect(t.has(9)).toBe(false);
  });

  test("vitals", () => {
    const v = vitals([req(1, {}), req(2, { cost: null, model: "x", tool_calls: ["Bash", "Read"] }), req(3, { state: "pending", ended_at: null, usage: null, cost: null, tool_calls: [] })]);
    expect(v).toMatchObject({ requests: 3, pending: 1, unpriced: 1, peakContext: 100, longest: 2 });
    expect(v.cost).toBeCloseTo(0.01);
    expect(v.cacheHitRate).toBeCloseTo(0.9);
    expect(v.slowest?.id).toBe(2);
    expect(v.avgHeaders).toBeCloseTo(0.5);
    expect(v.tools).toEqual([{ name: "Bash", count: 2 }, { name: "Read", count: 1 }]);
  });
});
