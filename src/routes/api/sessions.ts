import { createFileRoute } from "@tanstack/react-router";
import { publish } from "../../http/hub.server";
import { getBackend } from "../../backend.server";

export const Route = createFileRoute("/api/sessions")({
  server: {
    handlers: {
      GET: () => Response.json(getBackend().store.listSessions()),
      DELETE: () => {
        getBackend().store.clear();
        publish({ type: "reset" });
        return Response.json({ ok: true });
      },
    },
  },
});
