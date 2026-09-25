import { createFileRoute } from "@tanstack/react-router";
import { getBackend } from "../../backend.server";

export const Route = createFileRoute("/api/sessions/$id/requests")({
  server: {
    handlers: {
      GET: ({ params }) => Response.json(getBackend().store.listRequests(Number(params.id))),
    },
  },
});
