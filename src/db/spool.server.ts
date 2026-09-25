import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.server";
import type { IngestEvent } from "../llm/types";

/** Where the addon queues events for a database: one JSON file per event, next to the db. */
export const spoolDir = (dbPath: string) => `${dbPath}-spool`;

export interface Imported {
  sessionId: number;
  requestId: number;
  state: IngestEvent["state"];
}

/**
 * Import events the addon queued, oldest first, deleting each once ingested.
 * A file that fails is renamed to `.failed` so it can't block the queue.
 * Re-importing a file (e.g. after a crash before the delete) is harmless: ingest ignores finished flows.
 * Events whose request started before `cutoff` (epoch seconds) are deleted without being imported,
 * and don't count toward `limit`.
 */
export function drainSpool(store: Store, dir: string, limit = 200, cutoff?: number): Imported[] {
  mkdirSync(dir, { recursive: true });
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".json") && !n.startsWith("."))
    .sort();
  const out: Imported[] = [];
  for (const name of names) {
    if (out.length >= limit) break;
    const file = join(dir, name);
    try {
      const ev = JSON.parse(readFileSync(file, "utf8")) as IngestEvent;
      if (!ev?.flow_id || !ev.url) throw new Error("invalid event");
      if (cutoff !== undefined && ev.started_at < cutoff) {
        unlinkSync(file);
        continue;
      }
      out.push({ ...store.ingest(ev), state: ev.state });
      unlinkSync(file);
    } catch (e) {
      console.error("import failed for", file, e);
      try {
        renameSync(file, `${file}.failed`);
      } catch {}
    }
  }
  return out;
}
