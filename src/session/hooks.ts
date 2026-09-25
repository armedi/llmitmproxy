import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type RequestSummary, requestsQuery, type Session, sessionsQuery } from "../data/api";
import { useStored } from "../lib/hooks";

/** A session with its group: the main session when it's a subagent or side call, and its own subagents. */
export function useSession(id: number) {
  const { data: sessions } = useSuspenseQuery(sessionsQuery);
  const session = sessions.find((s) => s.id === id);
  return {
    session,
    parent: sessions.find((s) => s.id === session?.parent_id),
    children: sessions.filter((s) => s.parent_id === id),
  };
}

/** The session and its requests, for the views under /session/$id, which only render once it exists. */
export function useSessionRequests(id: number): { session: Session; requests: RequestSummary[] } {
  const { session } = useSession(id);
  const { data: requests } = useSuspenseQuery(requestsQuery(id));
  if (!session) throw new Error(`session ${id} is not loaded`);
  return { session, requests };
}

/**
 * The request the Raw view shows: the one in the URL, or else the latest.
 * One from another session (e.g. an edited URL) falls back to the latest too.
 */
export function useRawRequestId(session: Session, requests: RequestSummary[]): number {
  const rid = useParams({ from: "/session/$id/request/$rid", shouldThrow: false })?.rid;
  return rid != null && requests.some((r) => r.id === rid) ? rid : session.latest_request_id;
}

/** Open a request in the Raw view; the latest one gets the URL that keeps following new requests. */
export function useOpenRaw(session: Session) {
  const navigate = useNavigate();
  return (id: number) =>
    id === session.latest_request_id
      ? navigate({ to: "/session/$id/raw", params: { id: session.id } })
      : navigate({ to: "/session/$id/request/$rid", params: { id: session.id, rid: id } });
}

/** Only prompts and final answers. */
export const useFocused = () => useStored("focused", false);

/** Render message text as Markdown and fold XML tags. */
export const useFormatted = () => useStored("formatted", localStorage.getItem("textMode") !== "plain");
