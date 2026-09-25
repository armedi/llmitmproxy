import { createFileRoute } from "@tanstack/react-router";
import { publish } from "../../http/hub.server";
import { getBackend } from "../../backend.server";

export const Route = createFileRoute("/api/sessions/$id")({
  server: {
    handlers: {
      DELETE: ({ params }) => {
        const ids = getBackend().store.deleteSession(Number(params.id));
        publish({ type: "deleted", ids });
        return Response.json({ ok: true, ids });
      },
    },
  },
});
