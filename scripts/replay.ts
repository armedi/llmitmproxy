/**
 * POST the test fixtures to a running llmview server to try the UI without real traffic.
 *   bun scripts/replay.ts [--slow]
 */
import { anthropicTurns, geminiTurns, openaiChatTurns, openaiResponsesTurns } from "../test/fixtures";

const config = await Bun.file(new URL("../llmview.config.json", import.meta.url)).json().catch(() => ({}));
const url = process.env.LLMVIEW_URL ?? `http://127.0.0.1:${config.port ?? 4545}/ingest`;
const slow = process.argv.includes("--slow");
const now = Date.now() / 1000;

const events = [...anthropicTurns(), ...openaiChatTurns(), ...openaiResponsesTurns().chained, ...geminiTurns()];
for (const [i, ev] of events.entries()) {
  // Re-time the fixtures so they show up as recent.
  const shifted = { ...ev, started_at: now - (events.length - i) * 2, ended_at: now - (events.length - i) * 2 + 1.2 };
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
