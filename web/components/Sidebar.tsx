import { useState } from "react";
import { fmtAgo, fmtCost, type Session } from "../api";
import { groupStatus, STATUS_LABEL, sessionStatus, type Status } from "../status";

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  gemini: "Gemini",
  unknown: "Unknown",
};

export type GroupBy = "none" | "client" | "model" | "provider";

export interface Filters {
  q: string;
  provider: string;
  client: string;
  errors: boolean;
  recent: boolean;
  hideOneOff: boolean;
  group: GroupBy;
}

export const DEFAULT_FILTERS: Filters = { q: "", provider: "", client: "", errors: false, recent: false, hideOneOff: false, group: "none" };

/** Filters live in the URL (shareable, survive reload), falling back to the last used ones. */
export function readFilters(): Filters {
  const p = new URLSearchParams(location.search);
  let saved: Partial<Filters> = {};
  try {
    saved = JSON.parse(localStorage.getItem("filters") ?? "{}");
  } catch {}
  if (localStorage.getItem("hideOneOff") === "1") saved.hideOneOff ??= true; // older setting
  const f = { ...DEFAULT_FILTERS, ...saved, q: "" };
  if (!p.size) return f;
  return {
    q: p.get("q") ?? "",
    provider: p.get("provider") ?? "",
    client: p.get("client") ?? "",
    errors: p.get("errors") === "1",
    recent: p.get("recent") === "1",
    hideOneOff: p.get("oneoff") === "hide",
    group: (p.get("group") as GroupBy) ?? "none",
  };
}

export function writeFilters(f: Filters) {
  const { q: _q, ...keep } = f;
  localStorage.setItem("filters", JSON.stringify(keep));
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.provider) p.set("provider", f.provider);
  if (f.client) p.set("client", f.client);
  if (f.errors) p.set("errors", "1");
  if (f.recent) p.set("recent", "1");
  if (f.hideOneOff) p.set("oneoff", "hide");
  if (f.group !== "none") p.set("group", f.group);
  const qs = p.toString();
  history.replaceState(history.state, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
}

const activeCount = (f: Filters) => [f.provider, f.client, f.errors, f.recent, f.hideOneOff].filter(Boolean).length;

export interface Group {
  key: string;
  label: string;
  roots: Session[];
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
    if (f.hideOneOff && !(s.request_count > 1 || s.latest_msg_count > 1 || s.pending > 0 || s.child_count > 0)) return false;
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
  onSelect: (id: number) => void;
  now: number;
}

export function SessionList({ sessions, groups, children, filters, onFilters, selected, onSelect, now }: Props) {
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
        <input placeholder="Search sessions…" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
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
            <summary className="ghost-button" title="Filters">
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
        <div className="list-count muted">
          {total} session{total === 1 ? "" : "s"}
          {total !== sessions.filter((s) => s.parent_id == null).length && " (filtered)"}
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
                        onSelect={onSelect}
                        showClient={filters.group !== "client" && clients.length > 1}
                        cost={s.child_count ? s.group_cost : s.cost}
                      />
                      {open && kids.length > 0 && (
                        <ul className="children">
                          {kids.map((c) => (
                            <li key={c.id}>
                              <Row s={c} status={sessionStatus(c, now)} active={c.id === selected} now={now} onSelect={onSelect} child cost={c.cost} />
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
    </>
  );
}

function kindLabel(s: Session) {
  if (s.agent_id) return s.agent_name ?? "subagent";
  return s.latest_msg_count > 2 ? "thread" : "side call";
}

interface RowProps {
  s: Session;
  status: Status;
  active: boolean;
  inGroup?: boolean;
  now: number;
  kids?: number;
  open?: boolean;
  onToggle?: () => void;
  onSelect: (id: number) => void;
  child?: boolean;
  showClient?: boolean;
  cost: number;
}

function Row({ s, status, active, inGroup, now, kids = 0, open, onToggle, onSelect, child, showClient, cost }: RowProps) {
  return (
    <div className={`s-row ${active ? "active" : ""} ${inGroup && !active ? "in-group" : ""} ${child ? "child" : ""}`} onClick={() => onSelect(s.id)}>
      <span className="s-tree">
        {kids > 0 && (
          <button
            className="chev"
            title={open ? "Hide subagents" : "Show subagents and side calls"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </span>
      <span className={`status-dot ${status}`} title={STATUS_LABEL[status]} />
      <span className="s-body">
        <span className="s-title">
          {child && <span className={`chip kind ${s.agent_id ? "agent" : ""}`}>{kindLabel(s)}</span>}
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
    </div>
  );
}

const CLIENT_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  opencode: "opencode",
  cline: "Cline",
  kilo: "Kilo",
  roo: "Roo",
  cursor: "Cursor",
  aider: "Aider",
  codebuddy: "CodeBuddy",
  mimo: "MiMo",
  crush: "Crush",
  goose: "Goose",
};

/** The agent app, in its own color. */
export function ClientTag({ client }: { client: string | null }) {
  if (!client) return <span className="client-tag c-unknown">unknown</span>;
  return <span className={`client-tag c-${client}`}>{CLIENT_LABEL[client] ?? client}</span>;
}
