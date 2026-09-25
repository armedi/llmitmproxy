import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { requestQuery } from "../data/api";
import { RawView } from "../session/Raw";
import { useKeys } from "../lib/hooks";

/** One request's raw data, picked in the Raw view or linked from the conversation. */
export const Route = createFileRoute("/session/$id/request/$rid")({
  params: {
    parse: ({ rid }) => ({ rid: Number(rid) }),
    stringify: ({ rid }) => ({ rid: String(rid) }),
  },
  loader: ({ context: { queryClient }, params: { rid } }) => queryClient.ensureQueryData(requestQuery(rid)),
  component: RequestRoute,
});

function RequestRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  // Back to following the latest request.
  useKeys({
    Escape: () => {
      navigate({ to: "/session/$id/raw", params: { id } });
    },
  });
  return <RawView sessionId={id} />;
}
