import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useRef } from "react";
import { type RequestDetail, type RequestSummary, requestQuery, type Session, type Usage } from "../data/api";
import { contextTokens, fmtCost, fmtDuration, fmtSeconds, fmtTime, fmtTokens } from "../lib/format";
import { useOpenRaw, useRawRequestId } from "./hooks";
import { kindLabel } from "../components/labels";

function usageTitle(u: Usage) {
  return [
    `input ${(u.input ?? 0).toLocaleString()}`,
    u.cacheRead != null && `cache read ${u.cacheRead.toLocaleString()}`,
    u.cacheWrite != null && `cache write ${u.cacheWrite.toLocaleString()}`,
    `output ${(u.output ?? 0).toLocaleString()}`,
    u.reasoning != null && `reasoning ${u.reasoning.toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The Raw view's header line: which request, and how it went. */
export function RawMeta({ session, requests }: { session: Session; requests: RequestSummary[] }) {
  const shownId = useRawRequestId(session, requests);
  const openRaw = useOpenRaw(session);
  const { data: detail } = useQuery({ ...requestQuery(shownId), placeholderData: keepPreviousData });
  if (!detail) return null;
  return (
    <div className="session-meta small">
      <RequestPicker requests={requests} shownId={shownId} onOpen={openRaw} />
      <StatusChip d={detail} />
      <span className="chip" title={detail.response_started_at != null ? `Response started after ${fmtSeconds(detail.response_started_at - detail.started_at)}` : "Request duration"}>
        {fmtDuration(detail.started_at, detail.ended_at)}
      </span>
      {detail.usage && (
        <span className="chip" title={usageTitle(detail.usage)}>
          {fmtTokens(contextTokens(detail.usage))} ctx / {fmtTokens(detail.usage.output)} out
        </span>
      )}
      {detail.cost != null && <span className="chip cost">{fmtCost(detail.cost)}</span>}
      <span className="chip url" title={detail.url}>
        {detail.url}
      </span>
    </div>
  );
}

/** Pick which request the Raw view shows. */
function RequestPicker({ requests, shownId, onOpen }: { requests: RequestSummary[]; shownId: number; onOpen: (id: number) => void }) {
  if (!requests.length) return null;
  return (
    <select className="req-picker" value={shownId} onChange={(e) => onOpen(Number(e.target.value))} title="Which request to inspect">
      {requests.map((r, i) => (
        <option key={r.id} value={r.id}>
          Request {i + 1} of {requests.length} · {fmtTime(r.started_at)}
          {r.state === "pending" ? " · in flight" : r.tool_calls.length ? ` · ${[...new Set(r.tool_calls)].join(", ")}` : r.stop_reason ? ` · ${r.stop_reason}` : ""}
        </option>
      ))}
    </select>
  );
}

/** Links between a group's main session and its subagents and side calls. */
export function Related({ session, parent, children }: { session: Session; parent?: Session; children: Session[] }) {
  if (parent) {
    return (
      <div className="session-meta related-line">
        <span className="chip">{kindLabel(session)}</span>
        <span className="muted">of</span>
        <Link className="link" to="/session/$id" params={{ id: parent.id }} title="Open the main session">
          ← {parent.title}
        </Link>
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
          <li key={c.id}>
            <Link to="/session/$id" params={{ id: c.id }}>
              {c.pending > 0 && <span className="spinner" />}
              <span className={`chip ${c.agent_id ? "agent" : ""}`}>{kindLabel(c)}</span>
              <span className="related-title">{c.title}</span>
              <span className="muted">{c.request_count} req</span>
            </Link>
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
    const hint = r.status === 404 ? " The server may be running older code; restart `mitllmproxy`." : "";
    alert(`Export failed: HTTP ${r.status}.${hint}`);
    return;
  }
  const name = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "mitllmproxy-export.json";
  const href = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function ExportMenu({ session }: { session: Session }) {
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
      <summary className="ghost-button">
        <Download size={16} aria-hidden />
        Export
      </summary>
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
