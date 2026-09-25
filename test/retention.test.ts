import { beforeEach, describe, expect, test } from "vitest";
import { parseDuration } from "../src/backend.server";
import { Store } from "../src/db/store.server";
import { anthropicTurns } from "./fixtures";

let store: Store;
beforeEach(() => {
  store = new Store(":memory:");
});

describe("retention", () => {
  test("a session whose requests are all older than the cutoff is deleted", () => {
    const turns = anthropicTurns();
    const ids = turns.map((e) => store.ingest(e));
    const out = store.prune(turns[2]!.started_at + 1);
    expect(out).toEqual({ deleted: [ids[0]!.sessionId], updated: [] });
    expect(store.listSessions()).toHaveLength(0);
    expect(store.getRequest(ids[0]!.requestId)).toBeNull();
  });

  test("a partly expired session keeps its newer requests and recomputes its totals", () => {
    const turns = anthropicTurns();
    const ids = turns.map((e) => store.ingest(e));
    const before = store.getSession(ids[0]!.sessionId)!;
    const out = store.prune(turns[1]!.started_at);
    expect(out).toEqual({ deleted: [], updated: [ids[0]!.sessionId] });
    const s = store.getSession(ids[0]!.sessionId)!;
    expect(s.request_count).toBe(2);
    expect(s.created_at).toBe(turns[1]!.started_at);
    expect(s.latest_request_id).toBe(ids[2]!.requestId);
    expect(s.latest_msg_count).toBe(before.latest_msg_count);
    const kept = store.listRequests(s.id).map((r) => store.getRequest(r.id)!.usage);
    expect(s.input_tokens).toBe(kept.reduce((n, u) => n + (u?.input ?? 0), 0));
    expect(s.input_tokens).toBeLessThan(before.input_tokens);
    expect(s.output_tokens).toBe(kept.reduce((n, u) => n + (u?.output ?? 0), 0));
    const keptCost = store.listRequests(s.id).reduce((n, r) => n + (r.cost ?? 0), 0);
    expect(s.cost).toBeCloseTo(keptCost);
  });

  test("age comes from the request's start time, not when it was stored", () => {
    const [old] = anthropicTurns();
    const now = Date.now() / 1000;
    store.ingest({ ...old!, started_at: now - 8 * 86400, ended_at: now - 8 * 86400 + 1 });
    const [fresh] = anthropicTurns("aaaaaaaa-0000-0000-0000-000000000001", "fresh");
    store.ingest({ ...fresh!, started_at: now - 60, ended_at: now - 59 });
    expect(store.prune(now - 7 * 86400).deleted).toHaveLength(1);
    expect(store.listSessions().map((s) => s.title)).toEqual(["fresh"]);
  });

  test("nothing expired is a no-op", () => {
    anthropicTurns().forEach((e) => store.ingest(e));
    expect(store.prune(0)).toEqual({ deleted: [], updated: [] });
    expect(store.listSessions()[0]!.request_count).toBe(3);
  });

  test("parses durations", () => {
    expect(parseDuration("7d")).toBe(7 * 86400);
    expect(parseDuration("12h")).toBe(12 * 3600);
    expect(parseDuration("2w")).toBe(14 * 86400);
    expect(parseDuration("30m")).toBe(1800);
    expect(parseDuration("off")).toBe(0);
    expect(parseDuration("0")).toBe(0);
    expect(parseDuration("7")).toBeUndefined();
    expect(parseDuration("0d")).toBeUndefined();
    expect(parseDuration("foo")).toBeUndefined();
  });
});
