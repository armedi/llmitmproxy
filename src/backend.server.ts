import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { publish } from "./http/hub.server";
import { drainSpool, type Imported, spoolDir } from "./db/spool.server";
import { Store } from "./db/store.server";
import type { IngestEvent } from "./llm/types";

/** Same default as the addon, which writes captures next to it. */
const DEFAULT_DB = resolve(homedir(), ".llmitmproxy", "llmitmproxy.db");
/** Captures older than this, by request start time, are deleted. */
const DEFAULT_RETENTION_S = 7 * 86400;
const SPOOL_BATCH = 200;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

export interface BackendOptions {
  /** Address the HTTP server binds to; requests naming another host are refused. */
  host?: string;
  db?: string;
  /** Seconds to keep captures, counted from each request's start time; 0 keeps them forever. */
  retention?: number;
}

export type Backend = ReturnType<typeof createBackend>;

/** The store, plus the timers that import the addon's spool and prune old captures. */
function createBackend(opts: BackendOptions) {
  const dbPath = opts.db ?? DEFAULT_DB;
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new Store(dbPath);
  const host = opts.host ?? "127.0.0.1";
  const retention = opts.retention ?? DEFAULT_RETENTION_S;
  const cutoff = () => (retention > 0 ? Date.now() / 1000 - retention : undefined);
  const updated = (sessionId: number, requestId?: number, state?: IngestEvent["state"]) =>
    publish({ type: "update", session: store.getSession(sessionId), requestId, state });

  // The addon queues events as files in the spool dir; import them, including anything
  // captured while the server wasn't running.
  const spool = spoolDir(store.db.filename);
  const drain = () => {
    try {
      // Keep going while batches come back full, so a backlog is imported in one pass.
      let batch: Imported[];
      do {
        batch = drainSpool(store, spool, SPOOL_BATCH, cutoff());
        for (const { sessionId, requestId, state } of batch) updated(sessionId, requestId, state);
      } while (batch.length === SPOOL_BATCH);
    } catch (e) {
      console.error("importing spooled events failed", e);
    }
  };
  drain();

  const prune = () => {
    const before = cutoff();
    if (before === undefined) return;
    try {
      const { deleted, updated: changed } = store.prune(before);
      if (deleted.length) publish({ type: "deleted", ids: deleted });
      for (const id of changed) updated(id);
    } catch (e) {
      console.error("pruning old captures failed", e);
    }
  };
  prune();

  const timers = [setInterval(drain, 300), setInterval(prune, PRUNE_INTERVAL_MS)];
  const stop = () => {
    timers.forEach(clearInterval);
    store.db.close();
  };
  return { store, host, retention, spool, cutoff, updated, stop };
}

interface Slot {
  backend: Backend;
  opts: BackendOptions;
}
const SLOT = Symbol.for("llmitmproxy.backend");
const global = globalThis as { [SLOT]?: Slot };
let current: Backend | undefined;

/**
 * Start the backend, replacing a running one. In development Vite re-evaluates this module after
 * an edit; the old instance, still on globalThis, is stopped so its timers don't keep running.
 */
export function startBackend(opts: BackendOptions): Backend {
  global[SLOT]?.backend.stop();
  current = createBackend(opts);
  global[SLOT] = { backend: current, opts };
  return current;
}

/** The running backend, started from the environment on first use (development). */
export function getBackend(): Backend {
  return current ?? startBackend(global[SLOT]?.opts ?? optionsFromEnv());
}

function optionsFromEnv(): BackendOptions {
  const env = process.env;
  return {
    db: env.LLMITMPROXY_DB ? resolve(env.LLMITMPROXY_DB) : undefined,
    host: env.LLMITMPROXY_HOST,
    retention: env.LLMITMPROXY_RETENTION ? parseDuration(env.LLMITMPROXY_RETENTION) : undefined,
  };
}

/** Where captures are read from and kept, for the startup banner. */
export function describeBackend(b: Backend): string {
  return [
    `database:  ${b.store.db.filename}`,
    `spool:     ${b.spool}`,
    `retention: ${b.retention > 0 ? formatDuration(b.retention) : "forever"}`,
  ].join("\n");
}

const UNITS: [string, number][] = [["w", 7 * 86400], ["d", 86400], ["h", 3600], ["m", 60], ["s", 1]];

/** Parse a duration like `7d`, `12h`, `30m` or `2w` into seconds; `0` or `off` means keep forever. */
export function parseDuration(text: string): number | undefined {
  text = text.trim();
  if (text === "0" || text === "off") return 0;
  const m = /^(\d+)([wdhms])$/.exec(text);
  const size = m && UNITS.find(([u]) => u === m[2])?.[1];
  return m && size && Number(m[1]) > 0 ? Number(m[1]) * size : undefined;
}

function formatDuration(seconds: number): string {
  const [unit, size] = UNITS.find(([, s]) => seconds % s === 0) ?? ["s", 1];
  return `${seconds / size}${unit}`;
}
