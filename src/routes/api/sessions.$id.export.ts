import { createFileRoute } from "@tanstack/react-router";
import { downloadName, exportSession } from "../../db/export.server";
import { getBackend } from "../../backend.server";

export const Route = createFileRoute("/api/sessions/$id/export")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const { store } = getBackend();
        const session = store.getSession(Number(params.id));
        if (!session) return Response.json({ error: "not found" }, { status: 404 });
        const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "latest";
        return new Response(JSON.stringify(exportSession(store, session, scope), null, 2), {
          headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${downloadName(session, scope)}"` },
        });
      },
    },
  },
});
