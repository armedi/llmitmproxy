import { createFileRoute } from "@tanstack/react-router";
import { getBackend } from "../backend.server";
import type { IngestEvent } from "../llm/types";

export const Route = createFileRoute("/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ev = (await request.json().catch(() => null)) as IngestEvent | null;
        if (!ev?.flow_id || !ev.url) return Response.json({ error: "invalid event" }, { status: 400 });
        const backend = getBackend();
        const before = backend.cutoff();
        if (before !== undefined && ev.started_at < before) return Response.json({ ok: true, skipped: true });
        try {
          const { sessionId, requestId } = backend.store.ingest(ev);
          backend.updated(sessionId, requestId, ev.state);
          return Response.json({ ok: true, sessionId, requestId });
        } catch (e) {
          console.error("ingest failed", ev.url, e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
