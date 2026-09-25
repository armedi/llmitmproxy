import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { requestQuery, requestsQuery, type Session, sessionsQuery, type Update, useUpdates } from "./api";

/** Apply one live update from the server to the query cache. */
function apply(qc: QueryClient, u: Update) {
  const sessions = qc.getQueryData(sessionsQuery.queryKey) ?? [];
  const reload = () => qc.invalidateQueries({ queryKey: sessionsQuery.queryKey, exact: true });
  const setSessions = (fn: (list: Session[]) => Session[]) => qc.setQueryData(sessionsQuery.queryKey, (list) => fn(list ?? []));

  if (u.type === "reset") {
    setSessions(() => []);
    qc.removeQueries({ queryKey: ["requests"] });
    qc.removeQueries({ queryKey: ["request"] });
  } else if (u.type === "deleted") {
    const gone = new Set(u.ids);
    // Losing a group member changes the rest of the group (its main session, child count, group cost).
    const groups = new Set(sessions.filter((s) => gone.has(s.id) && s.session_id).map((s) => s.session_id));
    if (sessions.some((s) => !gone.has(s.id) && groups.has(s.session_id))) reload();
    setSessions((list) => list.filter((s) => !gone.has(s.id)));
    for (const id of u.ids) qc.removeQueries({ queryKey: requestsQuery(id).queryKey });
  } else if (u.type === "update" && u.session) {
    // A new session in a group changes its main session's child count and group cost, and a child
    // that outgrows the main session takes its place, so refetch.
    const prev = sessions.find((s) => s.id === u.session.id);
    if (u.session.session_id && (!prev || prev.parent_id !== u.session.parent_id || u.session.parent_id != null)) reload();
    setSessions((list) => [u.session, ...list.filter((s) => s.id !== u.session.id)].sort((a, b) => b.updated_at - a.updated_at));
    qc.invalidateQueries({ queryKey: requestsQuery(u.session.id).queryKey });
    if (u.requestId) qc.invalidateQueries({ queryKey: requestQuery(u.requestId).queryKey });
  }
}

/** Keep the query cache in sync with the server's live updates. Returns whether the socket is connected. */
export function useLiveUpdates(): boolean {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  useUpdates(
    (u) => {
      apply(qc, u);
      if (u.type === "reset") navigate({ to: "/" });
    },
    (ok) => {
      setConnected(ok);
      // Anything could have changed while disconnected.
      if (ok) qc.invalidateQueries();
    },
  );
  return connected;
}
