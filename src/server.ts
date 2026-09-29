import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { isTrusted } from "./http/guard.server";
import { getBackend } from "./backend.server";

export { parseDuration } from "./backend.server";
import { type ServerOptions, startServer as serveNode } from "./http/serve.server";

const fetch = (req: Request) =>
  isTrusted(new URL(req.url), req.headers.get("origin"), getBackend().host) ? handler.fetch(req) : new Response("forbidden", { status: 403 });

export default createServerEntry({ fetch });

/** Starts the production server; `bin/llmitmproxy` calls it on the built bundle. */
export const startServer = (opts: ServerOptions) => serveNode(opts, fetch);
