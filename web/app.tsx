import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, fmtAgo, fmtTokens, useUpdates, type Session } from "./api";
import { SessionView } from "./components/SessionView";
import { Settings } from "./components/Settings";

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  gemini: "Gemini",
  unknown: "Unknown",
};

function selectedFromPath(): number | null {
  const m = location.pathname.match(/^\/session\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<number | null>(selectedFromPath);
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [hideOneOff, setHideOneOff] = useState(() => localStorage.getItem("hideOneOff") === "1");
  const [showSettings, setShowSettings] = useState(false);
  const [tick, setTick] = useState<{ sessionId: number; n: number }>({ sessionId: 0, n: 0 });
  const now = useNow();

  const reload = useCallback(() => api.sessions().then(setSessions), []);
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onPop = () => setSelected(selectedFromPath());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => localStorage.setItem("hideOneOff", hideOneOff ? "1" : "0"), [hideOneOff]);

  useUpdates(
    (u) => {
      if (u.type === "reset") {
        setSessions([]);
        setSelected(null);
      } else if (u.type === "deleted") {
        setSessions((s) => s.filter((x) => !u.ids.includes(x.id)));
      } else if (u.type === "update" && u.session) {
        // A new session in a group changes its main session's child count, so refetch.
        if (!sessions.some((s) => s.id === u.session.id) && u.session.session_id) reload();
        setSessions((list) => [u.session, ...list.filter((s) => s.id !== u.session.id)].sort((a, b) => b.updated_at - a.updated_at));
        setTick((t) => ({ sessionId: u.session.id, n: t.n + 1 }));
      }
    },
    (ok) => {
      setConnected(ok);
      if (ok) reload();
    },
  );

  const select = (id: number | null) => {
    setSelected(id);
    history.pushState(null, "", id ? `/session/${id}` : "/");
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter(
      (s) =>
        s.parent_id == null &&
        (!provider || s.provider === provider) &&
        (!hideOneOff || s.request_count > 1 || s.latest_msg_count > 1 || s.pending > 0 || s.child_count > 0) &&
        (!q || s.title.toLowerCase().includes(q) || (s.model ?? "").toLowerCase().includes(q)),
    );
  }, [sessions, query, provider, hideOneOff]);

  // Auto-select the newest session on first load.
  useEffect(() => {
    if (selected == null && visible[0]) select(visible[0].id);
  }, [visible, selected]);

  const providers = [...new Set(sessions.map((s) => s.provider))];
  const current = sessions.find((s) => s.id === selected);
  const activeRoot = current?.parent_id ?? current?.id;

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="sidebar-head">
          <div className="brand">
            mitllmproxy <span className={`dot ${connected ? "on" : "off"}`} title={connected ? "live" : "disconnected"} />
          </div>
          <div className="head-actions">
            <button className="ghost" onClick={() => setShowSettings(true)} title="URL filters">
              Filters
            </button>
            <button
              className="ghost"
              onClick={() => confirm("Delete all captured sessions?") && api.clear()}
              title="Delete all sessions"
            >
              Clear
            </button>
          </div>
        </header>
        <div className="filters">
          <input placeholder="Search sessions…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="filter-row">
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p] ?? p}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={hideOneOff} onChange={(e) => setHideOneOff(e.target.checked)} />
              Hide one-off calls
            </label>
          </div>
        </div>
        <ul className="session-list">
          {visible.map((s) => (
            <li key={s.id} className={s.id === activeRoot ? "active" : ""} onClick={() => select(s.id)}>
              <div className="s-title">
                {s.pending > 0 && <span className="spinner" />}
                {s.last_error && <span className="err-dot" title={s.last_error} />}
                {s.title}
              </div>
              <div className="s-meta">
                <span className={`badge p-${s.provider}`}>{s.model ?? PROVIDER_LABEL[s.provider]}</span>
                <span>{s.request_count} req</span>
                {s.child_count > 0 && <span title="Subagents and side calls">+{s.child_count} sub</span>}
                <span>{fmtTokens(s.input_tokens + s.cache_read_tokens + s.cache_write_tokens)} in</span>
                <span className="ago">{fmtAgo(s.updated_at, now)}</span>
              </div>
            </li>
          ))}
          {!visible.length && (
            <li className="empty">
              {sessions.length ? "No sessions match the filters." : "Waiting for traffic… Route a client through mitmproxy with the mitllmproxy addon."}
            </li>
          )}
        </ul>
      </aside>
      <main className="main">
        {current ? (
          <SessionView
            key={current.id}
            session={current}
            parent={sessions.find((s) => s.id === current.parent_id)}
            children={sessions.filter((s) => s.parent_id === current.id)}
            onSelect={select}
            updateTick={tick.sessionId === current.id ? tick.n : 0}
            onDelete={() => api.deleteSession(current.id).then(() => select(current.parent_id))}
          />
        ) : (
          <div className="placeholder">Select a session</div>
        )}
      </main>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
