import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainSpool } from "../server/spool";
import { Store } from "../server/store";
import { anthropicTurns } from "./fixtures";

let store: Store;
let dir: string;
let seq = 0;
beforeEach(() => {
  store = new Store(":memory:");
  dir = mkdtempSync(join(tmpdir(), "mitllmproxy-spool-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// What the addon does: one JSON file per event, names sorting in write order.
const enqueue = (payload: unknown) =>
  writeFileSync(join(dir, `${String(++seq).padStart(20, "0")}-1-00000001.json`), typeof payload === "string" ? payload : JSON.stringify(payload));

describe("addon spool", () => {
  test("spooled events are ingested in order and deleted", () => {
    anthropicTurns().forEach(enqueue);
    const out = drainSpool(store, dir);
    expect(out).toHaveLength(3);
    expect(readdirSync(dir)).toHaveLength(0);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.request_count).toBe(3);
    expect(sessions[0]!.latest_request_id).toBe(out[2]!.requestId);
    expect(drainSpool(store, dir)).toHaveLength(0);
  });

  test("pending then done for the same flow ends as done", () => {
    const [t] = anthropicTurns();
    enqueue({ ...t, state: "pending", response_body: null, status: undefined });
    enqueue(t);
    const out = drainSpool(store, dir);
    expect(out.map((r) => r.state)).toEqual(["pending", "done"]);
    expect(out[0]!.requestId).toBe(out[1]!.requestId);
    expect(store.getRequest(out[1]!.requestId)!.state).toBe("done");
  });

  test("a bad file is set aside and doesn't block the ones after it", () => {
    const [t] = anthropicTurns();
    enqueue("{not json");
    enqueue({ state: "done" });
    enqueue(t);
    expect(drainSpool(store, dir)).toHaveLength(1);
    const left = readdirSync(dir);
    expect(left).toHaveLength(2);
    expect(left.every((n) => n.endsWith(".failed"))).toBe(true);
    expect(drainSpool(store, dir)).toHaveLength(0);
  });

  test("expired events are deleted without being imported and don't use up the batch", () => {
    const turns = anthropicTurns();
    turns.forEach(enqueue);
    const out = drainSpool(store, dir, 1, turns[2]!.started_at);
    expect(out).toHaveLength(1);
    expect(readdirSync(dir)).toHaveLength(0);
    expect(store.listSessions()[0]!.request_count).toBe(1);
  });

  test("ignores in-progress temp files and respects the batch limit", () => {
    writeFileSync(join(dir, ".00000000000000000000-1-00000001.json.tmp"), "{");
    anthropicTurns().forEach(enqueue);
    expect(drainSpool(store, dir, 2)).toHaveLength(2);
    expect(drainSpool(store, dir, 2)).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([".00000000000000000000-1-00000001.json.tmp"]);
  });
});
