import { createFileRoute } from "@tanstack/react-router";
import { requestQuery, sessionsQuery } from "../data/api";
import { RawView } from "../session/Raw";

/** The latest request's raw data, following new requests as they arrive. */
export const Route = createFileRoute("/session/$id/raw")({
  loader: async ({ context: { queryClient }, params: { id } }) => {
    const session = (await queryClient.ensureQueryData(sessionsQuery)).find((s) => s.id === id);
    if (session) await queryClient.ensureQueryData(requestQuery(session.latest_request_id));
  },
  component: RawRoute,
});

function RawRoute() {
  const { id } = Route.useParams();
  return <RawView sessionId={id} />;
}
