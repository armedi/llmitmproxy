import type { Server } from "node:http";
import { resolve } from "node:path";
import { serve } from "srvx/node";
import { staticMiddleware } from "srvx/static";
import { type BackendOptions, describeBackend, startBackend } from "../backend.server";
import { ROOT } from "../lib/paths.server";
import { attachUpdates } from "./ws.server";

export interface ServerOptions extends BackendOptions {
  port?: number;
}

/** Serve the built UI and the API with Node's HTTP server, plus live updates on `/ws`. */
export async function startServer(opts: ServerOptions, fetch: (req: Request) => Response | Promise<Response>) {
  const backend = startBackend(opts);
  const server = serve({
    // srvx's default, as for any TanStack Start app: $PORT, else 3000.
    port: opts.port,
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
  console.log(describeBackend(backend));
  return server;
}
