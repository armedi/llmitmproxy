import { resolve } from "node:path";
import index from "../web/index.html";
import { downloadName, exportSession } from "./export";
import { Store } from "./store";
import type { IngestEvent } from "./types";

const ROOT = resolve(import.meta.dir, "..");
const CONFIG_PATH = process.env.MITLLMPROXY_CONFIG ?? resolve(ROOT, "mitllmproxy.config.json");

async function readConfig(): Promise<Record<string, any>> {
  const f = Bun.file(CONFIG_PATH);
  return (await f.exists()) ? await f.json() : { port: 4545, urls: [] };
}

const config = await readConfig();
const port = Number(process.env.PORT ?? config.port ?? 4545);
const store = new Store(process.env.MITLLMPROXY_DB ?? resolve(ROOT, config.db ?? "mitllmproxy.db"));

const json = (data: unknown, status = 200) => Response.json(data, { status });
const idParam = (req: { params: { id: string } }) => Number(req.params.id);
const attachment = (data: unknown, filename: string) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${filename}"` },
  });

const server = Bun.serve({
  port,
  hostname: process.env.HOST ?? "127.0.0.1",
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: false },
  routes: {
    "/": index,
    "/session/:id": index,

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
        store.deleteSession(idParam(req));
        server.publish("updates", JSON.stringify({ type: "deleted", id: idParam(req) }));
        return json({ ok: true });
      },
    },
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
    "/api/config": {
      GET: async () => json({ path: CONFIG_PATH, config: await readConfig() }),
      PUT: async (req) => {
        const body = await req.json();
        if (!body || !Array.isArray(body.urls)) return json({ error: "config.urls must be an array" }, 400);
        await Bun.write(CONFIG_PATH, JSON.stringify(body, null, 2) + "\n");
        return json({ ok: true });
      },
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

console.log(`UI:              ${server.url}`);
console.log(`ingest endpoint: ${server.url}ingest`);
console.log(`database:        ${store.db.filename}`);
