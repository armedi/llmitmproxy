import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { downloadName, exportSession } from "./export";
import { drainSpool, type Imported, spoolDir } from "./spool";
import { Store } from "./store";
import type { IngestEvent } from "./types";
import { uiRoutes } from "./ui";

/** Same default as the addon, which writes captures next to it. */
const DEFAULT_DB = resolve(homedir(), ".mitllmproxy", "mitllmproxy.db");
const DEFAULT_PORT = 4545;
/** Captures older than this, by request start time, are deleted. */
const DEFAULT_RETENTION_S = 7 * 86400;
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
  const bindHost = opts.host ?? "127.0.0.1";
  // A web page can point its own hostname at 127.0.0.1 (DNS rebinding), which makes its requests
  // same-origin; so only accept the names this server is really reached by.
  const knownHost = (hostname: string) =>
    hostname === "localhost" || hostname === bindHost || isIP(hostname.replace(/^\[|\]$/g, "")) !== 0;
  // Browsers send Origin on cross-site requests; tools like the replay script send none.
  // Without this, any web page could read the captures over /api and /ws or inject them via /ingest.
  const trusted = (req: Request) => {
    const url = new URL(req.url);
    if (!knownHost(url.hostname)) return false;
    const origin = req.headers.get("origin");
    if (!origin) return true;
    try {
      return new URL(origin).host === url.host;
    } catch {
      return false;
    }
  };
  const guard =
    <R extends Request, A extends unknown[], T>(handler: (req: R, ...rest: A) => T) =>
    (req: R, ...rest: A): T | Response =>
      trusted(req) ? handler(req, ...rest) : new Response("forbidden", { status: 403 });
  const attachment = (data: unknown, filename: string) =>
    new Response(JSON.stringify(data, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${filename}"` },
    });

  const server = Bun.serve({
    port: opts.port ?? DEFAULT_PORT,
    hostname: opts.host ?? "127.0.0.1",
    development: opts.dev ? { hmr: true, console: false } : false,
    routes: {
      ...(await uiRoutes(!!opts.dev)),

      "/ingest": {
        POST: guard(async (req) => {
          const ev = (await req.json().catch(() => null)) as IngestEvent | null;
          if (!ev?.flow_id || !ev.url) return json({ error: "invalid event" }, 400);
          const before = cutoff();
          if (before !== undefined && ev.started_at < before) return json({ ok: true, skipped: true });
          try {
            const { sessionId, requestId } = store.ingest(ev);
            server.publish("updates", JSON.stringify({ type: "update", session: store.getSession(sessionId), requestId, state: ev.state }));
            return json({ ok: true, sessionId, requestId });
          } catch (e) {
            console.error("ingest failed", ev.url, e);
            return json({ error: String(e) }, 500);
          }
        }),
      },

      "/api/sessions": {
        GET: guard(() => json(store.listSessions())),
        DELETE: guard(() => {
          store.clear();
          server.publish("updates", JSON.stringify({ type: "reset" }));
          return json({ ok: true });
        }),
      },
      "/api/sessions/:id": {
        DELETE: guard((req) => {
          const ids = store.deleteSession(idParam(req));
          server.publish("updates", JSON.stringify({ type: "deleted", ids }));
          return json({ ok: true, ids });
        }),
      },
      "/api/sessions/:id/requests": guard((req) => json(store.listRequests(idParam(req)))),
      "/api/sessions/:id/export": guard((req) => {
        const session = store.getSession(idParam(req));
        if (!session) return json({ error: "not found" }, 404);
        const scope = new URL(req.url).searchParams.get("scope") === "all" ? "all" : "latest";
        return attachment(exportSession(store, session, scope), downloadName(session, scope));
      }),
      "/api/requests/:id": guard((req) => {
        const r = store.getRequest(idParam(req));
        return r ? json(r) : json({ error: "not found" }, 404);
      }),
      "/ws": guard((req: Request, srv: Bun.Server<undefined>) => (srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 }))),
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

  // `bun --hot` re-runs this on every edit but keeps old timers running; stop the previous run's.
  const hot = globalThis as { stopMitllmproxyTimers?: () => void };
  hot.stopMitllmproxyTimers?.();
  const timers = [setInterval(drain, 300), setInterval(prune, PRUNE_INTERVAL_MS)];
  hot.stopMitllmproxyTimers = () => timers.forEach(clearInterval);

  console.log(`UI:        ${server.url}`);
  console.log(`database:  ${store.db.filename}`);
  console.log(`spool:     ${spool}`);
  console.log(`retention: ${retention > 0 ? formatDuration(retention) : "forever"}`);

  return server;
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
