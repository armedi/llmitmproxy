import { createFileRoute } from "@tanstack/react-router";
import { getBackend } from "../../backend.server";

export const Route = createFileRoute("/api/requests/$id")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const r = getBackend().store.getRequest(Number(params.id));
        return r ? Response.json(r) : Response.json({ error: "not found" }, { status: 404 });
      },
    },
  },
});
