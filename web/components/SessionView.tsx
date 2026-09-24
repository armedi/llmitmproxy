import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, contextTokens, fmtCost, fmtDuration, fmtSeconds, fmtTime, fmtTokens, type RequestDetail, type RequestSummary, type Session } from "../api";
import { useKeys, useResizable, useStored } from "../hooks";
import { ClientTag } from "./Sidebar";
import { Conversation, type FindResult, type FindState } from "./Conversation";
import { FindBar, FindRail } from "./FindBar";
import { MarkdownMode } from "./Markdown";
import { Raw } from "./Raw";
import { Vitals } from "./Vitals";

interface Props {
  session: Session;
  /** The group's main session, when this is a subagent or side call. */
  parent?: Session;
  children: Session[];
  onSelect: (id: number) => void;
  /** The request to show; null follows the latest. */
  requestId: number | null;
  onOpenRequest: (id: number | null) => void;
  updateTick: number;
  onDelete: () => void;
}

export function SessionView({ session, parent, children, onSelect, requestId, onOpenRequest, updateTick, onDelete }: Props) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [tab, setTab] = useState<"conversation" | "raw">("conversation");
  const [markdown, setMarkdown] = useState(() => localStorage.getItem("textMode") !== "plain");
  const [focused, setFocused] = useStored("focused", false);
  const [showVitals, setShowVitals] = useStored("vitals", true);
  const [find, setFind] = useState<FindState | null>(null);
  const [found, setFound] = useState<FindResult>({ count: 0, marks: [] });
  const vitalsCol = useResizable("vitalsWidth", 320, 260, 560, "left");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => localStorage.setItem("textMode", markdown ? "markdown" : "plain"), [markdown]);

  // Every request in the session, for the timeline and per-turn stats.
  useEffect(() => {
    let cancelled = false;
    api.requests(session.id).then((r) => !cancelled && setRequests(r));
    return () => {
      cancelled = true;
    };
  }, [session.id, updateTick]);

  // The latest request carries the whole thread so far; its response is the newest assistant message.
  // A request id from another session (e.g. an edited URL) falls back to the latest.
  const foreign = requestId != null && requests.length > 0 && !requests.some((r) => r.id === requestId);
  const shownId = requestId != null && !foreign ? requestId : session.latest_request_id;
  const following = shownId === session.latest_request_id;
  useEffect(() => {
    let cancelled = false;
    api.request(shownId).then((d) => !cancelled && setDetail(d));
    return () => {
      cancelled = true;
    };
  }, [shownId, following || detail?.state === "pending" ? updateTick : 0]);

  // Keep the view pinned to the bottom as the thread grows, unless the user scrolled up or opened an older request.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current && following && tab === "conversation" && !find) el.scrollTop = el.scrollHeight;
  }, [detail, tab]);
  useEffect(() => {
    stickToBottom.current = following;
  }, [shownId]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useKeys({
    t: () => setTab((t) => (t === "conversation" ? "raw" : "conversation")),
    f: () => setFocused((f) => !f),
    v: () => setShowVitals((v) => !v),
    m: () => setMarkdown((m) => !m),
    // Raw tab keeps the browser's own find, which searches the full text view.
    "mod+f": () => (tab === "conversation" ? setFind((f) => f ?? { query: "", cursor: 0 }) : false),
    Escape: () => (find ? setFind(null) : requestId != null ? onOpenRequest(null) : false),
  });

  const n = detail?.normalized;
  const usage = n?.response?.usage;
  const ordinal = requests.findIndex((r) => r.id === shownId) + 1;
  const ctx = session.input_tokens + session.cache_read_tokens + session.cache_write_tokens;
  const groupCost = session.parent_id == null && session.child_count > 0;

  return (
    <div className="session-wrap" style={{ gridTemplateColumns: showVitals ? `1fr ${vitalsCol.width}px` : "1fr" }}>
      <div className="session">
        <header className="session-head">
          <div className="session-title-row">
            <h1 title={session.title}>{session.title}</h1>
            <button className={`ghost ${showVitals ? "on" : ""}`} onClick={() => setShowVitals(!showVitals)} title="Session vitals (v)">
              Vitals
            </button>
            <ExportMenu session={session} />
            <button
              className="ghost danger"
              onClick={() => confirm(children.length ? `Delete this session and its ${children.length} subagents and side calls?` : "Delete this session?") && onDelete()}
            >
              Delete
            </button>
          </div>
          <div className="session-meta">
            {session.client && <ClientTag client={session.client} />}
            <span className={`badge p-${session.provider}`}>{session.provider}</span>
            {session.model && <span className="chip">{session.model}</span>}
            <span className="chip" title="First request">
              {fmtTime(session.created_at)}
            </span>
            <span className="chip">{session.request_count} req</span>
            {session.session_id && (
              <span className="chip mono" title={session.agent_id ? `Agent session id · subagent ${session.agent_id}` : "Agent session id"}>
                {session.session_id}
              </span>
            )}
            <span className="spacer" />
            <span
              className="chip"
              title={`Totals across all requests in this session\ninput ${session.input_tokens.toLocaleString()} · cache read ${session.cache_read_tokens.toLocaleString()} · cache write ${session.cache_write_tokens.toLocaleString()} · output ${session.output_tokens.toLocaleString()}`}
            >
              Σ {fmtTokens(ctx)} ctx · cache r {fmtTokens(session.cache_read_tokens)} / w {fmtTokens(session.cache_write_tokens)} · {fmtTokens(session.output_tokens)} out
            </span>
            <span
              className="chip cost"
              title={`Estimated from list prices${session.unpriced ? ` · ${session.unpriced} requests with an unknown model price` : ""}${groupCost ? `\nthis session ${fmtCost(session.cost)}, with subagents ${fmtCost(session.group_cost)}` : ""}`}
            >
              {fmtCost(groupCost ? session.group_cost : session.cost)}
              {groupCost && <span className="muted"> total</span>}
              {session.unpriced > 0 && <span className="muted">*</span>}
            </span>
          </div>
          <Related session={session} parent={parent} children={children} onSelect={onSelect} />
          {detail && (
            <div className="session-meta small">
              {!following && (
                <span className="chip viewing">
                  Viewing request {ordinal || "?"} of {requests.length || session.request_count}
                  <button className="link" onClick={() => onOpenRequest(null)}>
                    Back to latest
                  </button>
                </span>
              )}
              <RequestPicker requests={requests} shownId={shownId} onOpen={(id) => onOpenRequest(id === session.latest_request_id ? null : id)} />
              <StatusChip d={detail} />
              <span className="chip" title="Request duration">
                {fmtDuration(detail.started_at, detail.ended_at)}
              </span>
              {detail.response_started_at != null && (
                <span className="chip" title="Time until response headers arrived">
                  headers {fmtSeconds(detail.response_started_at - detail.started_at)}
                </span>
              )}
              {usage && (
                <span className="chip">
                  in {fmtTokens(usage.input)}
                  {usage.cacheRead != null && ` · cache r ${fmtTokens(usage.cacheRead)}`}
                  {usage.cacheWrite != null && ` · w ${fmtTokens(usage.cacheWrite)}`} · out {fmtTokens(usage.output)}
                  {usage.reasoning != null && ` · reasoning ${fmtTokens(usage.reasoning)}`}
                  {` · ctx ${fmtTokens(contextTokens(usage))}`}
                </span>
              )}
              {detail.cost != null && <span className="chip cost">{fmtCost(detail.cost)}</span>}
              {n?.response?.stopReason && <span className="chip">stop: {n.response.stopReason}</span>}
              <span className="chip url" title={detail.url}>
                {detail.url}
              </span>
              <span className="spacer" />
              {tab === "conversation" && (
                <>
                  <button className={`ghost small ${focused ? "on" : ""}`} onClick={() => setFocused(!focused)} title="Only prompts and final answers (f)">
                    Focused
                  </button>
                  <div className="tabs" title="How message text is shown (m)">
                    <button className={markdown ? "on" : ""} onClick={() => setMarkdown(true)}>
                      Markdown
                    </button>
                    <button className={markdown ? "" : "on"} onClick={() => setMarkdown(false)}>
                      Plain
                    </button>
                  </div>
                </>
              )}
              <div className="tabs" title="Switch view (t)">
                <button className={tab === "conversation" ? "on" : ""} onClick={() => setTab("conversation")}>
                  Conversation
                </button>
                <button className={tab === "raw" ? "on" : ""} onClick={() => setTab("raw")}>
                  Raw
                </button>
              </div>
            </div>
          )}
        </header>
        {find && tab === "conversation" && <FindBar find={find} result={found} onChange={setFind} onClose={() => setFind(null)} />}
        <div className="session-body-wrap">
          <div className="session-body" ref={scroller} onScroll={onScroll}>
            {!detail ? (
              <div className="placeholder">Loading…</div>
            ) : tab === "conversation" ? (
              <MarkdownMode.Provider value={markdown}>
                <Conversation
                  detail={detail}
                  requests={requests}
                  sessionModel={session.model}
                  focused={focused}
                  find={find ?? NO_FIND}
                  onFind={setFound}
                  onOpenRequest={(id) => onOpenRequest(id === session.latest_request_id ? null : id)}
                />
              </MarkdownMode.Provider>
            ) : (
              <Raw detail={detail} />
            )}
          </div>
          {find && tab === "conversation" && <FindRail result={found} cursor={find.cursor} onJump={(i) => setFind({ ...find, cursor: i })} />}
        </div>
      </div>
      {showVitals && (
        <div className="vitals-col">
          <div className="resize-handle left" onPointerDown={vitalsCol.onPointerDown} />
          <Vitals session={session} requests={requests} viewing={shownId} onOpenRequest={(id) => onOpenRequest(id === session.latest_request_id ? null : id)} />
        </div>
      )}
    </div>
  );
}

const NO_FIND: FindState = { query: "", cursor: 0 };

/** Jump to any request of the session. */
function RequestPicker({ requests, shownId, onOpen }: { requests: RequestSummary[]; shownId: number; onOpen: (id: number) => void }) {
  if (requests.length < 2) return null;
  return (
    <select className="req-picker" value={shownId} onChange={(e) => onOpen(Number(e.target.value))} title="Open another request of this session">
      {requests.map((r, i) => (
        <option key={r.id} value={r.id}>
          Request {i + 1} of {requests.length} · {fmtTime(r.started_at)} · {r.msg_count} msgs
          {r.state === "pending" ? " · in flight" : r.stop_reason ? ` · ${r.stop_reason}` : ""}
        </option>
      ))}
    </select>
  );
}

function kindLabel(s: Session) {
  if (s.agent_id) return s.agent_name ?? "subagent";
  return s.latest_msg_count > 2 ? "thread" : "side call";
}

/** Links between a group's main session and its subagents and side calls. */
function Related({ session, parent, children, onSelect }: Pick<Props, "session" | "parent" | "children" | "onSelect">) {
  if (parent) {
    return (
      <div className="session-meta small">
        <span className="chip">{kindLabel(session)}</span>
        <span className="muted">of</span>
        <button className="link" onClick={() => onSelect(parent.id)} title="Open the main session">
          ← {parent.title}
        </button>
      </div>
    );
  }
  if (!children.length) return null;
  const counts = new Map<string, number>();
  for (const c of children) {
    const k = c.agent_id ? "subagent" : kindLabel(c);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return (
    <details className="related">
      <summary className="muted">{[...counts].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(" · ")}</summary>
      <ul>
        {children.map((c) => (
          <li key={c.id} onClick={() => onSelect(c.id)}>
            {c.pending > 0 && <span className="spinner" />}
            <span className={`chip ${c.agent_id ? "agent" : ""}`}>{kindLabel(c)}</span>
            <span className="related-title">{c.title}</span>
            <span className="muted">{c.request_count} req</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Fetch first so a failed export shows a real error instead of the browser's generic download failure. */
async function download(url: string) {
  const r = await fetch(url);
  if (!r.ok) {
    const hint = r.status === 404 ? " The server may be running older code; restart `bun start`." : "";
    alert(`Export failed: HTTP ${r.status}.${hint}`);
    return;
  }
  const name = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "mitllmproxy-export.json";
  const href = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function ExportMenu({ session }: { session: Session }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const item = (url: string, label: string, hint: string) => (
    <button
      onClick={() => {
        ref.current?.removeAttribute("open");
        download(url);
      }}
    >
      {label}
      <span className="muted">{hint}</span>
    </button>
  );
  return (
    <details className="menu" ref={ref}>
      <summary className="ghost-button">Export</summary>
      <div className="menu-items">
        {item(`/api/sessions/${session.id}/export?scope=latest`, "Latest request + response", "The full conversation, as sent")}
        {item(`/api/sessions/${session.id}/export?scope=all`, `All ${session.request_count} requests`, "Every raw request and response in the session")}
      </div>
    </details>
  );
}

function StatusChip({ d }: { d: RequestDetail }) {
  if (d.state === "pending") return <span className="chip pending"><span className="spinner" /> in flight</span>;
  const bad = d.state === "error" || (d.status ?? 0) >= 400;
  return <span className={`chip ${bad ? "bad" : "ok"}`}>{d.status ?? d.state}</span>;
}
