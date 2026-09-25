import type { Server } from "node:http";
import { resolve } from "node:path";
import { serve } from "srvx/node";
import { staticMiddleware } from "srvx/static";
import { type BackendOptions, formatDuration, startBackend } from "../backend.server";
import { ROOT } from "../lib/paths.server";
import { attachUpdates } from "./ws.server";

const DEFAULT_PORT = 4545;

export interface ServerOptions extends BackendOptions {
  port?: number;
}

/** Serve the built UI and the API with Node's HTTP server, plus live updates on `/ws`. */
export async function startServer(opts: ServerOptions, fetch: (req: Request) => Response | Promise<Response>) {
  const backend = startBackend(opts);
  const server = serve({
    port: opts.port ?? DEFAULT_PORT,
    hostname: backend.host,
    silent: true,
    // Exit on Ctrl-C right away rather than waiting for open websockets to close.
    gracefulShutdown: false,
    middleware: [staticMiddleware({ dir: resolve(ROOT, "dist", "client") })],
    fetch,
  });
  await server.ready();
  attachUpdates(server.node!.server as Server, backend.host, true);

  console.log(`UI:        ${server.url}`);
  console.log(`database:  ${backend.store.db.filename}`);
  console.log(`spool:     ${backend.spool}`);
  console.log(`retention: ${backend.retention > 0 ? formatDuration(backend.retention) : "forever"}`);
  return server;
}
