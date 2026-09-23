import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, fmtDuration, fmtTokens, type RequestDetail, type RequestSummary, type Session } from "../api";
import { Conversation } from "./Conversation";
import { Raw } from "./Raw";

interface Props {
  session: Session;
  updateTick: number;
  onDelete: () => void;
}

export function SessionView({ session, updateTick, onDelete }: Props) {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  // null = follow the latest request as new ones arrive
  const [pinned, setPinned] = useState<number | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [tab, setTab] = useState<"conversation" | "raw">("conversation");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const shownId = pinned ?? session.latest_request_id;

  useEffect(() => {
    api.session(session.id).then((r) => setRequests(r.requests));
  }, [session.id, updateTick]);

  useEffect(() => {
    let cancelled = false;
    api.request(shownId).then((d) => !cancelled && setDetail(d));
    return () => {
      cancelled = true;
    };
  }, [shownId, pinned == null ? updateTick : 0]);

  // Keep the view pinned to the bottom while following, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current && tab === "conversation") el.scrollTop = el.scrollHeight;
  }, [detail, tab]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const index = requests.findIndex((r) => r.id === shownId);
  const n = detail?.normalized;
  const usage = n?.response?.usage;

  return (
    <div className="session">
      <header className="session-head">
        <div className="session-title-row">
          <h1 title={session.title}>{session.title}</h1>
          <ExportMenu session={session} shownId={shownId} />
          <button className="ghost danger" onClick={() => confirm("Delete this session?") && onDelete()}>
            Delete
          </button>
        </div>
        <div className="session-meta">
          <span className={`badge p-${session.provider}`}>{session.provider}</span>
          {detail?.model && <span className="chip">{detail.model}</span>}
          <label className="req-picker">
            Request
            <select
              value={shownId}
              onChange={(e) => {
                const id = Number(e.target.value);
                setPinned(id === session.latest_request_id ? null : id);
              }}
            >
              {requests.map((r, i) => (
                <option key={r.id} value={r.id}>
                  #{i + 1} · {r.msg_count} msgs · {r.state}
                  {r.id === session.latest_request_id ? " · latest" : ""}
                </option>
              ))}
            </select>
            of {requests.length}
          </label>
          {pinned != null ? (
            <button className="ghost" onClick={() => setPinned(null)}>
              ↓ Follow latest
            </button>
          ) : (
            <span className="chip live">following latest</span>
          )}
          <span className="spacer" />
          <span className="chip" title="Totals across all requests in this session">
            Σ in {fmtTokens(session.input_tokens)} · cache r {fmtTokens(session.cache_read_tokens)} / w {fmtTokens(session.cache_write_tokens)} · out{" "}
            {fmtTokens(session.output_tokens)}
          </span>
        </div>
        {detail && (
          <div className="session-meta small">
            <StatusChip d={detail} />
            <span className="chip">{fmtDuration(detail.started_at, detail.ended_at)}</span>
            {usage && (
              <span className="chip">
                in {fmtTokens(usage.input)}
                {usage.cacheRead != null && ` · cache r ${fmtTokens(usage.cacheRead)}`}
                {usage.cacheWrite != null && ` · w ${fmtTokens(usage.cacheWrite)}`} · out {fmtTokens(usage.output)}
                {usage.reasoning != null && ` · reasoning ${fmtTokens(usage.reasoning)}`}
              </span>
            )}
            {n?.response?.stopReason && <span className="chip">stop: {n.response.stopReason}</span>}
            <span className="chip url" title={detail.url}>
              {detail.url}
            </span>
            <span className="spacer" />
            <div className="tabs">
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
      <div className="session-body" ref={scroller} onScroll={onScroll}>
        {!detail ? (
          <div className="placeholder">Loading…</div>
        ) : tab === "conversation" ? (
          <Conversation detail={detail} />
        ) : (
          <Raw detail={detail} />
        )}
        {index >= 0 && index < requests.length - 1 && pinned != null && (
          <div className="muted center">Viewing an older request ({index + 1} of {requests.length}).</div>
        )}
      </div>
    </div>
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
  const name = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "llmview-export.json";
  const href = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function ExportMenu({ session, shownId }: { session: Session; shownId: number }) {
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
        {shownId !== session.latest_request_id &&
          item(`/api/requests/${shownId}/export`, "Shown request + response", "The older request you're viewing")}
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
