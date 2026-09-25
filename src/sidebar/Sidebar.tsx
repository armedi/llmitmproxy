import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { ListFilter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ClientTag, kindLabel, PROVIDER_LABEL } from "../components/labels";
import { type Session, sessionsQuery } from "../data/api";
import { fmtAgo, fmtCost } from "../lib/format";
import { useNow } from "../lib/hooks";
import { activeCount, DEFAULT_FILTERS, type Filters, filtersFromSearch, type GroupBy } from "./filters";
import { groupStatus, STATUS_LABEL, sessionStatus, type Status } from "./status";

export interface Group {
  key: string;
  label: string;
  roots: Session[];
}

/** All sessions, and the main ones that pass the filters in the URL, grouped as the sidebar shows them. */
export function useArranged() {
  const { data: sessions } = useSuspenseQuery(sessionsQuery);
  const search = useSearch({ from: "__root__" });
  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const now = useNow();
  const { groups, children } = useMemo(() => arrange(sessions, filters, now), [sessions, filters, now]);
  return { sessions, filters, groups, children, now };
}

/** Main sessions that pass the filters, grouped. Children come along with their main session. */
export function arrange(sessions: Session[], f: Filters, nowMs: number): { groups: Group[]; children: Map<number, Session[]> } {
  const children = new Map<number, Session[]>();
  for (const s of sessions) if (s.parent_id != null) children.set(s.parent_id, [...(children.get(s.parent_id) ?? []), s]);
  const q = f.q.trim().toLowerCase();
  const family = (s: Session) => [s, ...(children.get(s.id) ?? [])];
  const roots = sessions.filter((s) => {
    if (s.parent_id != null) return false;
    const fam = family(s);
    if (f.provider && s.provider !== f.provider) return false;
    if (f.client && (s.client ?? "") !== f.client) return false;
    if (f.errors && !fam.some((c) => c.last_error)) return false;
    if (f.recent && nowMs / 1000 - Math.max(...fam.map((c) => c.updated_at)) > 86400) return false;
    if (f.hideOneOff && (isSideCall(s) || !(s.request_count > 1 || s.latest_msg_count > 1 || s.pending > 0 || s.child_count > 0))) return false;
    if (q && !fam.some((c) => [c.title, c.model, c.session_id, c.client, c.agent_name].some((v) => v?.toLowerCase().includes(q)))) return false;
    return true;
  });
  if (f.group === "none") return { groups: [{ key: "", label: "", roots }], children };
  const key = (s: Session) => (f.group === "client" ? (s.client ?? "") : f.group === "model" ? (s.model ?? "") : s.provider);
  const label = (k: string) => (k ? (f.group === "provider" ? (PROVIDER_LABEL[k] ?? k) : k) : f.group === "client" ? "Unknown client" : "Unknown model");
  const map = new Map<string, Session[]>();
  for (const s of roots) map.set(key(s), [...(map.get(key(s)) ?? []), s]);
  // Groups keep recency order: the group with the most recent session first.
  const groups = [...map].map(([k, rs]) => ({ key: k, label: label(k), roots: rs }));
  return { groups, children };
}

interface Props {
  sessions: Session[];
  groups: Group[];
  children: Map<number, Session[]>;
  filters: Filters;
  onFilters: (f: Filters) => void;
  selected: number | null;
  now: number;
  /** Actions shown beside the session count, under the list. */
  footer?: React.ReactNode;
}

export function SessionList({ sessions, groups, children, filters, onFilters, selected, now, footer }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const current = sessions.find((s) => s.id === selected);
  const activeRoot = current?.parent_id ?? current?.id;
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  };
  const providers = [...new Set(sessions.map((s) => s.provider))].sort();
  const clients = [...new Set(sessions.map((s) => s.client ?? ""))].sort();
  const total = groups.reduce((a, g) => a + g.roots.length, 0);
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });

  return (
    <>
      <div className="filters">
        <label className="search">
          <Search size={16} aria-hidden />
          <input type="search" placeholder="Search sessions…" aria-label="Search sessions" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </label>
        <div className="filter-row">
          <div className="seg" title="Group sessions by">
            {(["none", "client", "model", "provider"] as GroupBy[]).map((g) => (
              <button key={g} className={filters.group === g ? "on" : ""} onClick={() => set({ group: g })}>
                {g === "none" ? "Recent" : g === "provider" ? "API" : g[0]!.toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <details className="menu filter-menu">
            <summary className="ghost-button small" title="Filters">
              <ListFilter size={16} aria-hidden />
              Filter{activeCount(filters) > 0 && <span className="filter-dot" />}
            </summary>
            <div className="menu-items filter-items">
              <label>
                API
                <select value={filters.provider} onChange={(e) => set({ provider: e.target.value })}>
                  <option value="">All</option>
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABEL[p] ?? p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Client
                <select value={filters.client} onChange={(e) => set({ client: e.target.value })}>
                  <option value="">All</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c || "Unknown"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={filters.errors} onChange={(e) => set({ errors: e.target.checked })} />
                Errors only
              </label>
              <label className="check">
                <input type="checkbox" checked={filters.recent} onChange={(e) => set({ recent: e.target.checked })} />
                Active in the last 24h
              </label>
              <label className="check">
                <input type="checkbox" checked={filters.hideOneOff} onChange={(e) => set({ hideOneOff: e.target.checked })} />
                Hide one-off calls
              </label>
              {activeCount(filters) > 0 && (
                <button className="link" onClick={() => onFilters({ ...DEFAULT_FILTERS, q: filters.q, group: filters.group })}>
                  Clear filters
                </button>
              )}
            </div>
          </details>
        </div>
      </div>
      <ul className="session-list">
        {groups.map((g) => (
          <li key={g.key} className="group">
            {filters.group !== "none" && (
              <button className="group-head" onClick={() => setFolded(toggle(folded, g.key))}>
                <span className="chev">{folded.has(g.key) ? "▸" : "▾"}</span>
                {filters.group === "client" ? <ClientTag client={g.key || null} /> : <span>{g.label}</span>}
                <span className="muted">{g.roots.length}</span>
              </button>
            )}
            {!folded.has(g.key) && (
              <ul>
                {g.roots.map((s) => {
                  const kids = children.get(s.id) ?? [];
                  const open = expanded.has(s.id) || (activeRoot === s.id && current?.parent_id != null);
                  return (
                    <li key={s.id}>
                      <Row
                        s={s}
                        status={groupStatus([s, ...kids], now)}
                        active={s.id === selected}
                        inGroup={activeRoot === s.id}
                        now={now}
                        kids={kids.length}
                        open={open}
                        onToggle={() => setExpanded(toggle(expanded, s.id))}
                        showClient={filters.group !== "client" && clients.length > 1}
                        cost={s.child_count ? s.group_cost : s.cost}
                      />
                      {open && kids.length > 0 && (
                        <ul className="children">
                          {kids.map((c) => (
                            <li key={c.id}>
                              <Row s={c} status={sessionStatus(c, now)} active={c.id === selected} now={now} child cost={c.cost} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
        {!total && (
          <li className="empty">
            {sessions.length ? "No sessions match the filters." : "Waiting for traffic… Route a client through mitmproxy with the mitllmproxy addon."}
          </li>
        )}
      </ul>
      <footer className="sidebar-foot">
        <span className="list-count">
          {total} session{total === 1 ? "" : "s"}
          {total !== sessions.filter((s) => s.parent_id == null).length && " (filtered)"}
        </span>
        {footer}
      </footer>
    </>
  );
}

/** A side call whose main session isn't known, such as Codex's title thread. */
const isSideCall = (s: Session) => s.parent_id == null && !!s.agent_id?.startsWith("side:");

interface RowProps {
  s: Session;
  status: Status;
  active: boolean;
  inGroup?: boolean;
  now: number;
  kids?: number;
  open?: boolean;
  onToggle?: () => void;
  child?: boolean;
  showClient?: boolean;
  cost: number;
}

function Row({ s, status, active, inGroup, now, kids = 0, open, onToggle, child, showClient, cost }: RowProps) {
  return (
    <div className={`s-row ${active ? "active" : ""} ${inGroup && !active ? "in-group" : ""} ${child ? "child" : ""}`}>
      <span className="s-tree">
        {kids > 0 && (
          <button
            className="chev"
            title={open ? "Hide subagents" : "Show subagents and side calls"}
            aria-label={open ? "Hide subagents" : "Show subagents and side calls"}
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </span>
      <Link to="/session/$id" params={{ id: s.id }} className="s-main" aria-current={active ? "page" : undefined}>
        <span className={`status-dot ${status}`} title={STATUS_LABEL[status]} />
        <span className="s-body">
          <span className="s-title">
            {(child || isSideCall(s)) && <span className={`chip kind ${s.agent_id ? "agent" : ""}`}>{kindLabel(s)}</span>}
            {s.title}
          </span>
          <span className="s-meta">
            {!child && <span className="s-model">{s.model ?? PROVIDER_LABEL[s.provider]}</span>}
            <span>{s.request_count} req</span>
            {kids > 0 && <span title="Subagents and side calls">+{kids} sub</span>}
            {cost > 0 && <span title={kids ? "Estimated cost, subagents included" : "Estimated cost"}>{fmtCost(cost)}</span>}
            <span className="ago">{fmtAgo(s.updated_at, now)}</span>
          </span>
        </span>
        {showClient && !child && s.client && <ClientTag client={s.client} />}
      </Link>
    </div>
  );
}
