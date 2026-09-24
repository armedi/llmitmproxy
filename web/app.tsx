import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, useUpdates, type Session } from "./api";
import { useConfirm } from "./components/Confirm";
import { Help } from "./components/Help";
import { SessionView } from "./components/SessionView";
import { arrange, type Filters, readFilters, SessionList, writeFilters } from "./components/Sidebar";
import { useKeys, useNow, useResizable, useStored } from "./hooks";
import { useTheme } from "./theme";

interface Route {
  session: number | null;
  request: number | null;
}

function routeFromPath(): Route {
  const m = location.pathname.match(/^\/session\/(\d+)(?:\/request\/(\d+))?/);
  return { session: m ? Number(m[1]) : null, request: m?.[2] ? Number(m[2]) : null };
}

const THEME_LABEL = { system: "Auto", light: "Light", dark: "Dark" } as const;

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [route, setRoute] = useState<Route>(routeFromPath);
  const [connected, setConnected] = useState(false);
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [tick, setTick] = useState<{ sessionId: number; n: number }>({ sessionId: 0, n: 0 });
  const [sidebarOpen, setSidebarOpen] = useStored("sidebar", true);
  const [help, setHelp] = useState(false);
  const [theme, cycleTheme] = useTheme();
  const [confirmDialog, askConfirm] = useConfirm();
  const sidebar = useResizable("sidebarWidth", 340, 220, 520, "right");
  const now = useNow();
  const selected = route.session;

  const reload = useCallback(() => api.sessions().then(setSessions), []);
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => writeFilters(filters), [filters]);

  useUpdates(
    (u) => {
      if (u.type === "reset") {
        setSessions([]);
        setRoute({ session: null, request: null });
      } else if (u.type === "deleted") {
        setSessions((s) => s.filter((x) => !u.ids.includes(x.id)));
      } else if (u.type === "update" && u.session) {
        // A new session in a group changes its main session's child count and group cost, so refetch.
        if (u.session.session_id && (!sessions.some((s) => s.id === u.session.id) || u.session.parent_id != null)) reload();
        setSessions((list) => [u.session, ...list.filter((s) => s.id !== u.session.id)].sort((a, b) => b.updated_at - a.updated_at));
        setTick((t) => ({ sessionId: u.session.id, n: t.n + 1 }));
      }
    },
    (ok) => {
      setConnected(ok);
      if (ok) reload();
    },
  );

  const navigate = (r: Route) => {
    setRoute(r);
    const path = r.session ? `/session/${r.session}${r.request ? `/request/${r.request}` : ""}` : "/";
    history.pushState(null, "", path + location.search);
  };
  const select = (id: number | null) => navigate({ session: id, request: null });

  const { groups, children } = useMemo(() => arrange(sessions, filters, now), [sessions, filters, now]);
  const order = useMemo(() => groups.flatMap((g) => g.roots.flatMap((r) => [r, ...(children.get(r.id) ?? [])])), [groups, children]);

  // Auto-select the newest session on first load.
  useEffect(() => {
    if (selected == null && groups[0]?.roots[0]) select(groups[0].roots[0].id);
  }, [groups, selected]);

  const current = sessions.find((s) => s.id === selected);
  const step = (d: number) => {
    const roots = order.filter((s) => s.parent_id == null);
    const at = roots.findIndex((s) => s.id === (current?.parent_id ?? current?.id));
    const next = roots[Math.max(0, Math.min(roots.length - 1, at + d))];
    if (next) select(next.id);
  };
  const roots = sessions.filter((s) => s.parent_id == null).length;
  const clearAll = () =>
    askConfirm({
      title: "Delete all sessions?",
      body: (
        <p>
          All {roots} session{roots === 1 ? "" : "s"}
          {sessions.length > roots && `, with their ${sessions.length - roots} subagents and side calls,`} will be permanently deleted from the database.
        </p>
      ),
      action: "Delete all",
      onConfirm: () => api.clear(),
    });
  const deleteSession = (s: Session) => {
    const kids = sessions.filter((c) => c.parent_id === s.id).length;
    askConfirm({
      title: "Delete this session?",
      body: (
        <>
          <p className="confirm-target">{s.title}</p>
          <p>
            {s.request_count} captured request{s.request_count === 1 ? "" : "s"}
            {kids > 0 && `, plus ${kids} subagent${kids === 1 ? "" : "s"} and side call${kids === 1 ? "" : "s"},`} will be permanently deleted.
          </p>
        </>
      ),
      action: "Delete session",
      onConfirm: () => api.deleteSession(s.id).then(() => select(s.parent_id)),
    });
  };

  useKeys({
    "]": () => step(1),
    "[": () => step(-1),
    b: () => setSidebarOpen((o) => !o),
    "?": () => setHelp((h) => !h),
    Escape: () => (help ? setHelp(false) : false),
  });

  return (
    <div className="app" style={{ gridTemplateColumns: sidebarOpen ? `${sidebar.width}px 1fr` : "1fr" }}>
      {sidebarOpen && (
        <aside className="sidebar">
          <header className="sidebar-head">
            <div className="brand">mitllmproxy</div>
            <span className={`live ${connected ? "on" : "off"}`} title={connected ? "Receiving updates from the server" : "Lost the connection to the server; retrying"}>
              {connected ? "live" : "offline"}
            </span>
            <span className="spacer" />
            <button className="ghost small" onClick={cycleTheme} title="Theme: follow the system, light or dark">
              {THEME_LABEL[theme]}
            </button>
            <button className="ghost small icon" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
              ?
            </button>
            <button className="ghost small icon" onClick={() => setSidebarOpen(false)} title="Hide sidebar (b)" aria-label="Hide sidebar">
              ⟨
            </button>
          </header>
          <SessionList
            sessions={sessions}
            groups={groups}
            children={children}
            filters={filters}
            onFilters={setFilters}
            selected={selected}
            onSelect={select}
            now={now}
            footer={
              <button className="ghost small danger" onClick={clearAll} disabled={!sessions.length} title="Delete all sessions (asks first)">
                Delete all
              </button>
            }
          />
          <div className="resize-handle right" onPointerDown={sidebar.onPointerDown} />
        </aside>
      )}
      <main className="main">
        {!sidebarOpen && (
          <button className="ghost small icon sidebar-show" onClick={() => setSidebarOpen(true)} title="Show sidebar (b)" aria-label="Show sidebar">
            ⟩
          </button>
        )}
        {current ? (
          <SessionView
            key={current.id}
            session={current}
            parent={sessions.find((s) => s.id === current.parent_id)}
            children={sessions.filter((s) => s.parent_id === current.id)}
            onSelect={select}
            requestId={route.request}
            onOpenRequest={(id) => navigate({ session: current.id, request: id })}
            updateTick={tick.sessionId === current.id ? tick.n : 0}
            onDelete={() => deleteSession(current)}
          />
        ) : (
          <div className="placeholder">Select a session</div>
        )}
      </main>
      {help && <Help onClose={() => setHelp(false)} />}
      {confirmDialog}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
