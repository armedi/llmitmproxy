/**
 * POST the test fixtures to a running mitllmproxy server to try the UI without real traffic.
 *   bun scripts/replay.ts [--slow]
 */
import { ANTHROPIC_URL, anthropicTurns, event, geminiTurns, openaiChatTurns, openaiResponsesTurns } from "../test/fixtures";

const url = process.env.MITLLMPROXY_URL ?? "http://127.0.0.1:4545/ingest";
const slow = process.argv.includes("--slow");
const now = Date.now() / 1000;

const events = [...anthropicTurns(), ...openaiChatTurns(), ...openaiResponsesTurns().chained, ...geminiTurns(), ...demoSession()];
for (const [i, ev] of events.entries()) {
  // Re-time the fixtures so they show up as recent.
  const start = now - (events.length - i) * 2;
  const took = 0.8 + ((i * 7) % 5) * 0.6;
  const shifted = { ...ev, started_at: start, response_started_at: start + 0.3 + (i % 3) * 0.2, ended_at: start + took };
  if (slow) {
    await post({ ...shifted, state: "pending", response_body: null, status: undefined });
    await Bun.sleep(700);
  }
  await post(shifted);
}
console.log(`replayed ${events.length} events to ${url}`);

async function post(ev: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev) });
  if (!r.ok) console.error(r.status, await r.text());
}

/** A Claude Code–like session exercising edits, parallel calls, reminders and thinking. */
function demoSession() {
  const sid = "d3m0d3m0-0000-4000-8000-000000000001";
  const headers = { "content-type": "application/json", "user-agent": "claude-cli/2.1.0 (external, cli)", "x-claude-code-session-id": sid };
  const tools = ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "TodoWrite", "Task"].map((name) => ({ name, description: `${name} tool`, input_schema: { type: "object" } }));
  const turns: { calls?: [string, unknown, string][]; text?: string; thinking?: string }[] = [
    { thinking: "The user wants retries. Look at the client first.", calls: [["TodoWrite", { todos: [{ content: "Find the HTTP client", status: "in_progress" }, { content: "Add retry with backoff", status: "pending" }] }, "Todos updated"]] },
    { calls: [["Grep", { pattern: "fetch\\(", path: "src" }, "src/http.ts\nsrc/api/client.ts"], ["Glob", { pattern: "src/**/*.test.ts" }, "src/http.test.ts"]] },
    { calls: [["Read", { file_path: "/Users/dev/proj/src/http.ts" }, "export async function get(url: string) {\n  const r = await fetch(url);\n  return r.json();\n}"]] },
    { text: "I'll add a retry loop with exponential backoff.", calls: [["Edit", { file_path: "/Users/dev/proj/src/http.ts", old_string: "export async function get(url: string) {\n  const r = await fetch(url);\n  return r.json();\n}", new_string: "export async function get(url: string, retries = 3) {\n  for (let i = 0; ; i++) {\n    const r = await fetch(url);\n    if (r.ok || i >= retries) return r.json();\n    await sleep(2 ** i * 100);\n  }\n}" }, "The file has been updated."]] },
    { calls: [["Write", { file_path: "/Users/dev/proj/src/sleep.ts", content: "export const sleep = (ms: number) =>\n  new Promise((r) => setTimeout(r, ms));\n" }, "File created."]] },
    { calls: [["Bash", { command: "bun test src/http.test.ts", description: "Run the HTTP tests" }, "error: expected 3 calls, got 1\n 1 fail"]] },
    { thinking: "The mock returns ok on the first call.", calls: [["Bash", { command: "bun test src/http.test.ts" }, " 4 pass\n 0 fail"]] },
    { text: "Retries are in place:\n\n- `get()` retries up to **3** times with exponential backoff\n- new helper `sleep()` in `src/sleep.ts`\n\n```ts\nconst data = await get(url, 5);\n```\n\nAll 4 tests pass." },
  ];
  const messages: any[] = [
    { role: "user", content: [{ type: "text", text: "<system-reminder>\nToday is 2026-09-24.\n</system-reminder>" }, { type: "text", text: "Add retries to the HTTP client" }] },
  ];
  const out = [];
  let n = 0;
  for (const t of turns) {
    const content: any[] = [];
    if (t.thinking) content.push({ type: "thinking", thinking: t.thinking, signature: "sig" });
    if (t.text) content.push({ type: "text", text: t.text });
    for (const [name, input] of t.calls ?? []) content.push({ type: "tool_use", id: `toolu_demo_${++n}`, name, input });
    const body = { model: "claude-sonnet-5", max_tokens: 32000, system: [{ type: "text", text: "You are Claude Code." }], tools, messages: structuredClone(messages) };
    const prompt = 3000 + messages.length * 900;
    const resp = { id: `msg_demo_${n}`, type: "message", role: "assistant", model: "claude-sonnet-5", content, stop_reason: t.calls ? "tool_use" : "end_turn", usage: { input_tokens: 40, cache_read_input_tokens: prompt, cache_creation_input_tokens: 600, output_tokens: 120 + content.length * 80 } };
    out.push(event(ANTHROPIC_URL, body, resp, { request_headers: headers }));
    messages.push({ role: "assistant", content });
    if (t.calls) {
      const results: any[] = (t.calls ?? []).map(([, , result], i) => ({ type: "tool_result", tool_use_id: `toolu_demo_${n - (t.calls!.length - 1) + i}`, content: result, is_error: result.includes("fail") && !result.includes("0 fail") }));
      if (messages.length === 8) results.push({ type: "text", text: "<system-reminder>\nThe TodoWrite tool hasn't been used recently.\n</system-reminder>" });
      messages.push({ role: "user", content: results });
    }
  }
  return out;
}
