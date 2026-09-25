import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { PanelRight, Trash2 } from "lucide-react";
import { api, requestsQuery, type Session } from "../data/api";
import { fmtCost, fmtTime } from "../lib/format";
import { useConfirm } from "../components/Confirm";
import { ExportMenu, RawMeta, Related } from "../session/SessionHeader";
import { ClientTag } from "../components/labels";
import { Vitals } from "../session/Vitals";
import { useKeys, useResizable, useStored } from "../lib/hooks";
import { useFocused, useFormatted, useOpenRaw, useSession } from "../session/hooks";

export const Route = createFileRoute("/session/$id")({
  params: {
    parse: ({ id }) => ({ id: Number(id) }),
    stringify: ({ id }) => ({ id: String(id) }),
  },
  // A different session starts fresh: scroll position, find, open menus.
  remountDeps: ({ params }) => params.id,
  loader: ({ context: { queryClient }, params: { id } }) => queryClient.ensureQueryData(requestsQuery(id)),
  component: SessionRoute,
});

function SessionRoute() {
  const { id } = Route.useParams();
  const { session, parent, children } = useSession(id);
  // Deleted, or older than the list the server returns.
  if (!session) return <div className="placeholder">Select a session</div>;
  return <SessionLayout session={session} parent={parent} children={children} />;
}

const RAW_ROUTES = new Set(["/session/$id/raw", "/session/$id/request/$rid"]);

function SessionLayout({ session, parent, children }: { session: Session; parent?: Session; children: Session[] }) {
  const { data: requests } = useSuspenseQuery(requestsQuery(session.id));
  const raw = useRouterState({ select: (s) => RAW_ROUTES.has(s.matches.at(-1)?.routeId ?? "") });
  const navigate = useNavigate();
  const openRaw = useOpenRaw(session);
  const [focused, setFocused] = useFocused();
  const [formatted, setFormatted] = useFormatted();
  const [showVitals, setShowVitals] = useStored("vitals", true);
  const vitalsCol = useResizable("vitalsWidth", 320, 260, 560, "left");
  const [confirmDialog, askConfirm] = useConfirm();

  const kids = children.length;
  const deleteSession = () =>
    askConfirm({
      title: "Delete this session?",
      body: (
        <>
          <p className="confirm-target">{session.title}</p>
          <p>
            {session.request_count} captured request{session.request_count === 1 ? "" : "s"}
            {kids > 0 && `, plus ${kids} subagent${kids === 1 ? "" : "s"} and side call${kids === 1 ? "" : "s"},`} will be permanently deleted.
          </p>
        </>
      ),
      action: "Delete session",
      onConfirm: async () => {
        await api.deleteSession(session.id);
        if (session.parent_id != null) navigate({ to: "/session/$id", params: { id: session.parent_id } });
        else navigate({ to: "/" });
      },
    });

  useKeys({
    t: () => {
      if (raw) navigate({ to: "/session/$id", params: { id: session.id } });
      else openRaw(session.latest_request_id);
    },
    v: () => setShowVitals((v) => !v),
  });

  const groupCost = session.parent_id == null && session.child_count > 0;

  return (
    <div className="session-wrap" style={{ gridTemplateColumns: showVitals ? `1fr ${vitalsCol.width}px` : "1fr" }}>
      <div className="session">
        <header className="session-head">
          <div className="session-title-row">
            <h1 title={session.title}>{session.title}</h1>
            <ExportMenu session={session} />
            <button className="ghost danger" onClick={deleteSession} title="Delete this session (asks first)">
              <Trash2 size={16} aria-hidden />
              Delete
            </button>
            <button className={`ghost ${showVitals ? "on" : ""}`} onClick={() => setShowVitals(!showVitals)} title="Session stats panel (v)">
              <PanelRight size={16} aria-hidden />
              Stats
            </button>
          </div>
          <div className="session-meta readout">
            {session.client && <ClientTag client={session.client} />}
            {session.model && <span className="model">{session.model}</span>}
            <span
              className="cost"
              title={`Estimated from list prices${session.unpriced ? ` · ${session.unpriced} requests with an unknown model price` : ""}${groupCost ? `\nthis session ${fmtCost(session.cost)}, with subagents ${fmtCost(session.group_cost)}` : ""}`}
            >
              {fmtCost(groupCost ? session.group_cost : session.cost)}
              {groupCost && <span className="muted"> incl. subagents</span>}
              {session.unpriced > 0 && <span className="muted">*</span>}
            </span>
            <span>
              {session.request_count} request{session.request_count === 1 ? "" : "s"}
            </span>
            <span>started {fmtTime(session.created_at)}</span>
          </div>
          <Related session={session} parent={parent} children={children} />
          <div className="session-tabs">
            <div className="tabs underline" role="tablist" title="Switch view (t)">
              <Link role="tab" aria-selected={!raw} className={raw ? "" : "on"} to="/session/$id" params={{ id: session.id }}>
                Conversation
              </Link>
              <Link role="tab" aria-selected={raw} className={raw ? "on" : ""} to="/session/$id/raw" params={{ id: session.id }}>
                Raw
              </Link>
            </div>
            <span className="spacer" />
            {!raw && (
              <>
                <button className={`toggle ${focused ? "on" : ""}`} aria-pressed={focused} onClick={() => setFocused(!focused)} title="Only prompts and final answers (f)">
                  Focused
                </button>
                <button className={`toggle ${formatted ? "on" : ""}`} aria-pressed={formatted} onClick={() => setFormatted(!formatted)} title="Render message text as Markdown and fold XML tags (m)">
                  Formatted
                </button>
              </>
            )}
          </div>
          {raw && <RawMeta session={session} requests={requests} />}
        </header>
        <Outlet />
      </div>
      {showVitals && (
        <div className="vitals-col">
          <div className="resize-handle left" onPointerDown={vitalsCol.onPointerDown} />
          <Vitals session={session} requests={requests} onOpenRequest={openRaw} />
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
