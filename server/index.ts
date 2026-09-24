import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import index from "../web/index.html";
import { downloadName, exportSession } from "./export";
import { drainSpool, type Imported, spoolDir } from "./spool";
import { Store } from "./store";
import type { IngestEvent } from "./types";

/** Same default as the addon, which writes captures next to it. */
export const DEFAULT_DB = resolve(homedir(), ".mitllmproxy", "mitllmproxy.db");
export const DEFAULT_PORT = 4545;
/** Captures older than this, by request start time, are deleted. */
export const DEFAULT_RETENTION_S = 7 * 86400;
const SPOOL_BATCH = 200;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

export interface StartOptions {
  port?: number;
  host?: string;
  db?: string;
  dev?: boolean;
  /** Seconds to keep captures, counted from each request's start time; 0 keeps them forever. */
  retention?: number;
}

export async function startServer(opts: StartOptions = {}) {
  const dbPath = opts.db ?? DEFAULT_DB;
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new Store(dbPath);
  const retention = opts.retention ?? DEFAULT_RETENTION_S;
  const cutoff = () => (retention > 0 ? Date.now() / 1000 - retention : undefined);

  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const idParam = (req: { params: { id: string } }) => Number(req.params.id);
  const attachment = (data: unknown, filename: string) =>
    new Response(JSON.stringify(data, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${filename}"` },
    });

  const server = Bun.serve({
    port: opts.port ?? DEFAULT_PORT,
    hostname: opts.host ?? "127.0.0.1",
    development: opts.dev ? { hmr: true, console: false } : false,
    routes: {
      "/": index,
      "/session/:id": index,
      "/session/:id/request/:rid": index,

      "/ingest": {
        POST: async (req) => {
          const ev = (await req.json()) as IngestEvent;
          if (!ev?.flow_id || !ev.url) return json({ error: "invalid event" }, 400);
          try {
            const { sessionId, requestId } = store.ingest(ev);
            server.publish("updates", JSON.stringify({ type: "update", session: store.getSession(sessionId), requestId, state: ev.state }));
            return json({ ok: true, sessionId, requestId });
          } catch (e) {
            console.error("ingest failed", ev.url, e);
            return json({ error: String(e) }, 500);
          }
        },
      },

      "/api/sessions": {
        GET: () => json(store.listSessions()),
        DELETE: () => {
          store.clear();
          server.publish("updates", JSON.stringify({ type: "reset" }));
          return json({ ok: true });
        },
      },
      "/api/sessions/:id": {
        DELETE: (req) => {
          const ids = store.deleteSession(idParam(req));
          server.publish("updates", JSON.stringify({ type: "deleted", ids }));
          return json({ ok: true, ids });
        },
      },
      "/api/sessions/:id/requests": (req) => json(store.listRequests(idParam(req))),
      "/api/sessions/:id/export": (req) => {
        const session = store.getSession(idParam(req));
        if (!session) return json({ error: "not found" }, 404);
        const scope = new URL(req.url).searchParams.get("scope") === "all" ? "all" : "latest";
        return attachment(exportSession(store, session, scope), downloadName(session, scope));
      },
      "/api/requests/:id": (req) => {
        const r = store.getRequest(idParam(req));
        return r ? json(r) : json({ error: "not found" }, 404);
      },
      "/ws": (req, srv) => (srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 })),
    },
    websocket: {
      open: (ws) => {
        ws.subscribe("updates");
      },
      message: () => {},
    },
  });

  // The addon queues events as files in the spool dir; import them, including anything
  // captured while the server wasn't running.
  const spool = spoolDir(store.db.filename);
  const drain = () => {
    try {
      // Keep going while batches come back full, so a backlog is imported in one pass.
      let batch: Imported[];
      do {
        batch = drainSpool(store, spool, SPOOL_BATCH, cutoff());
        for (const { sessionId, requestId, state } of batch) {
          server.publish("updates", JSON.stringify({ type: "update", session: store.getSession(sessionId), requestId, state }));
        }
      } while (batch.length === SPOOL_BATCH);
    } catch (e) {
      console.error("importing spooled events failed", e);
    }
  };
  drain();
  setInterval(drain, 300);

  const prune = () => {
    const before = cutoff();
    if (before === undefined) return;
    try {
      const { deleted, updated } = store.prune(before);
      if (deleted.length) server.publish("updates", JSON.stringify({ type: "deleted", ids: deleted }));
      for (const id of updated) server.publish("updates", JSON.stringify({ type: "update", session: store.getSession(id) }));
    } catch (e) {
      console.error("pruning old captures failed", e);
    }
  };
  prune();
  setInterval(prune, PRUNE_INTERVAL_MS);

  console.log(`UI:        ${server.url}`);
  console.log(`database:  ${store.db.filename}`);
  console.log(`spool:     ${spool}`);
  console.log(`retention: ${retention > 0 ? formatDuration(retention) : "forever"}`);

  return server;
}

const UNITS: [string, number][] = [["w", 7 * 86400], ["d", 86400], ["h", 3600], ["m", 60], ["s", 1]];

/** Parse a duration like `7d`, `12h`, `30m` or `2w` into seconds; `0` or `off` means keep forever. */
export function parseDuration(text: string): number | undefined {
  if (text === "0" || text === "off") return 0;
  const m = /^(\d+)([wdhms])$/.exec(text.trim());
  const size = m && UNITS.find(([u]) => u === m[2])?.[1];
  return m && size && Number(m[1]) > 0 ? Number(m[1]) * size : undefined;
}

function formatDuration(seconds: number): string {
  const [unit, size] = UNITS.find(([, s]) => seconds % s === 0)!;
  return `${seconds / size}${unit}`;
}
