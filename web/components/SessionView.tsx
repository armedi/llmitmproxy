import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, fmtDuration, fmtTokens, type RequestDetail, type Session } from "../api";
import { Conversation } from "./Conversation";
import { MarkdownMode } from "./Markdown";
import { Raw } from "./Raw";

interface Props {
  session: Session;
  updateTick: number;
  onDelete: () => void;
}

export function SessionView({ session, updateTick, onDelete }: Props) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [tab, setTab] = useState<"conversation" | "raw">("conversation");
  const [markdown, setMarkdown] = useState(() => localStorage.getItem("textMode") !== "plain");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => localStorage.setItem("textMode", markdown ? "markdown" : "plain"), [markdown]);

  // The latest request carries the whole thread so far; its response is the newest assistant message.
  useEffect(() => {
    let cancelled = false;
    api.request(session.latest_request_id).then((d) => !cancelled && setDetail(d));
    return () => {
      cancelled = true;
    };
  }, [session.latest_request_id, updateTick]);

  // Keep the view pinned to the bottom as the thread grows, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current && tab === "conversation") el.scrollTop = el.scrollHeight;
  }, [detail, tab]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const n = detail?.normalized;
  const usage = n?.response?.usage;

  return (
    <div className="session">
      <header className="session-head">
        <div className="session-title-row">
          <h1 title={session.title}>{session.title}</h1>
          <ExportMenu session={session} />
          <button className="ghost danger" onClick={() => confirm("Delete this session?") && onDelete()}>
            Delete
          </button>
        </div>
        <div className="session-meta">
          <span className={`badge p-${session.provider}`}>{session.provider}</span>
          {detail?.model && <span className="chip">{detail.model}</span>}
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
            {tab === "conversation" && (
              <div className="tabs" title="How message text is shown">
                <button className={markdown ? "on" : ""} onClick={() => setMarkdown(true)}>
                  Markdown
                </button>
                <button className={markdown ? "" : "on"} onClick={() => setMarkdown(false)}>
                  Plain
                </button>
              </div>
            )}
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
          <MarkdownMode.Provider value={markdown}>
            <Conversation detail={detail} />
          </MarkdownMode.Provider>
        ) : (
          <Raw detail={detail} />
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
