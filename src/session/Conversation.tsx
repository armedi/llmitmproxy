import { TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Block, type RequestDetail, type RequestSummary, type ToolDef } from "../data/api";
import { contextTokens, fmtCost, fmtDuration, fmtTokens } from "../lib/format";
import { useKeys } from "../lib/hooks";
import { buildItems, focusItems, type Item, itemText, type MessageItem } from "./transcript/items";
import { type Turn, turnsByIndex } from "./transcript/stats";
import { category } from "./transcript/tools";
import { Blocks, ForceOpen, LazyDetails, Text, Thread, type ThreadInfo } from "./Blocks";
import { Copy } from "../components/Copy";

export interface FindState {
  query: string;
  cursor: number;
}

export interface FindResult {
  count: number;
  /** Positions of the matches, as fractions of the transcript height. */
  marks: number[];
}

interface Props {
  detail: RequestDetail;
  requests: RequestSummary[];
  /** The session's usual model; turns only show theirs when it differs. */
  sessionModel: string | null;
  focused: boolean;
  find: FindState;
  onFind: (r: FindResult) => void;
  onOpenRequest: (id: number) => void;
}

export function Conversation({ detail, requests, sessionModel, focused, find, onFind, onOpenRequest }: Props) {
  const n = detail.normalized;
  const pending = detail.state === "pending";
  const { items: all, results } = useMemo(() => buildItems(n, pending), [n, pending]);
  const items = useMemo(() => (focused ? focusItems(all) : all), [all, focused]);
  const thread = useMemo<ThreadInfo>(() => {
    const toolNames = new Map<string, string>();
    const visit = (blocks: Block[]) => blocks.forEach((b) => b.type === "tool_use" && b.id && toolNames.set(b.id, b.name));
    n.messages.forEach((m) => visit(m.content));
    if (n.response) visit(n.response.blocks);
    return { results, toolNames, pending };
  }, [n, results, pending]);

  // Which request produced each assistant message; the response is this request's own.
  const turns = useMemo(() => {
    const t = turnsByIndex(requests, detail.msg_count);
    const own = requests.findIndex((r) => r.id === detail.id);
    if (own >= 0) t.set(n.messages.length, { request: requests[own]!, ordinal: own + 1 });
    return t;
  }, [requests, detail.id, detail.msg_count, n.messages.length]);

  // ---- find ----
  const q = find.query.trim().toLowerCase();
  const matches = useMemo(() => (q ? items.map((it, i) => (itemText(it, results).includes(q) ? i : -1)).filter((i) => i >= 0) : []), [items, results, q]);
  const current = matches.length ? matches[((find.cursor % matches.length) + matches.length) % matches.length]! : -1;
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const h = el.scrollHeight || 1;
    const marks = matches.map((i) => (el.querySelector<HTMLElement>(`[data-item="${i}"]`)?.offsetTop ?? 0) / h);
    onFind({ count: matches.length, marks });
    if (current >= 0) el.querySelector(`[data-item="${current}"]`)?.scrollIntoView({ block: "center" });
    highlight(el, q, current);
  }, [matches, current, q, onFind]);
  useEffect(() => () => highlight(null, "", -1), []);

  // ---- j/k navigation ----
  const [sel, setSel] = useState(-1);
  const go = (i: number) => {
    const next = Math.max(0, Math.min(items.length - 1, i));
    setSel(next);
    root.current?.querySelector(`[data-item="${next}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const isPrompt = (it: Item) => it.kind === "message" && it.role === "user";
  const seek = (dir: 1 | -1) => {
    for (let i = sel + dir; i >= 0 && i < items.length; i += dir) if (isPrompt(items[i]!)) return go(i);
  };
  useKeys({
    j: () => go(sel + 1),
    k: () => go(sel < 0 ? items.length - 1 : sel - 1),
    J: () => seek(1),
    K: () => seek(-1),
  });

  const params = Object.entries(n.params ?? {}).filter(([, v]) => v !== undefined);
  const view = { turns, sessionModel, onOpenRequest, detail };

  return (
    <Thread.Provider value={thread}>
      <div className="conversation" ref={root}>
        {!focused && n.system.length > 0 && (
          <Section label="system" title="System prompt" count={n.system.length > 1 ? `${n.system.length} blocks` : undefined}>
            <SystemBlocks blocks={n.system} />
          </Section>
        )}
        {!focused && n.tools.length > 0 && (
          <Section label="tools" title="Tool definitions" count={String(n.tools.length)}>
            <Tools tools={n.tools} />
          </Section>
        )}
        {!focused && params.length > 0 && (
          <Section label="params" title="Parameters" count={String(params.length)}>
            <pre className="json">{JSON.stringify(Object.fromEntries(params), null, 2)}</pre>
          </Section>
        )}

        {items.map((it, i) => (
          <div key={`${it.kind}-${it.index}`} data-item={i} className={`item ${i === sel ? "selected" : ""} ${i === current ? "find-current" : ""}`}>
            <ForceOpen.Provider value={i === current}>
              <ItemView item={it} {...view} />
            </ForceOpen.Provider>
          </div>
        ))}
        {!items.length && <div className="placeholder">No messages.</div>}
      </div>
    </Thread.Provider>
  );
}

type ViewProps = Pick<Props, "sessionModel" | "onOpenRequest" | "detail"> & { turns: Map<number, Turn> };

function ItemView({ item, ...v }: ViewProps & { item: Item }) {
  switch (item.kind) {
    case "tools":
      return <ToolGroup item={item} {...v} />;
    case "message":
      return <MessageView item={item} {...v} />;
  }
}

function MessageView({ item, turns, sessionModel, onOpenRequest, detail }: ViewProps & { item: MessageItem }) {
  const turn = item.role === "assistant" ? turns.get(item.index) : undefined;
  const pending = item.response && detail.state === "pending";
  const error = item.response ? detail.normalized.response?.error : undefined;
  const text = () =>
    item.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n\n");
  return (
    <div className={`msg ${item.role}`}>
      <div className="gutter">
        <span className="role-label">{item.role}</span>
      </div>
      <div className="msg-main">
        <div className="msg-head">
          {pending && (
            <span className="muted">
              <span className="spinner" /> responding…
            </span>
          )}
          <span className="spacer" />
          {turn && <TurnMeta turn={turn} sessionModel={sessionModel} onOpenRequest={onOpenRequest} />}
          <Copy text={text} label="Copy message text" className="hover-only" iconOnly />
        </div>
        {error && (
          <div className="error-banner">
            <TriangleAlert size={16} aria-hidden />
            <span>{error}</span>
          </div>
        )}
        {item.blocks.length > 0 ? (
          <Blocks blocks={item.blocks} prose live={item.response} />
        ) : (
          !pending && !error && <div className="muted">{item.response ? "(empty response)" : "(empty)"}</div>
        )}
      </div>
    </div>
  );
}

/** Consecutive tool-only assistant turns, collapsed into one block. */
function ToolGroup({ item, ...v }: ViewProps & { item: Extract<Item, { kind: "tools" }> }) {
  const counts = new Map<string, number>();
  for (const m of item.items) for (const b of m.blocks) if (b.type === "tool_use") counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
  return (
    <details className="tool-group" open>
      <summary>
        <span className="tg-title">{item.calls} tool calls</span>
        <span className="tg-names">
          {[...counts].map(([name, c]) => (
            <span key={name} className={`tg-name cat-${category(name)}`}>
              {name}
              {c > 1 && <span className="muted"> ×{c}</span>}
            </span>
          ))}
        </span>
      </summary>
      {item.items.map((m) => (
        <div key={m.index} className="tg-step">
          <div className="tg-step-head">
            <span className="spacer" />
            {v.turns.get(m.index) && <TurnMeta turn={v.turns.get(m.index)!} sessionModel={v.sessionModel} onOpenRequest={v.onOpenRequest} />}
          </div>
          <Blocks blocks={m.blocks} prose />
        </div>
      ))}
    </details>
  );
}

/** Duration, tokens and cost of the request that produced a message, linking to its raw capture. */
function TurnMeta({ turn: { request: r, ordinal }, sessionModel, onOpenRequest }: { turn: Turn; sessionModel: string | null; onOpenRequest: (id: number) => void }) {
  const u = r.usage;
  const bad = r.state === "error" || (r.status ?? 0) >= 400;
  return (
    <span className="turn-meta">
      {r.model && r.model !== sessionModel && <span className="chip model">{r.model}</span>}
      {bad && <span className="chip bad">{r.status ?? "error"}</span>}
      {r.state !== "pending" && <span title="Request duration">{fmtDuration(r.started_at, r.ended_at)}</span>}
      {u && (
        <span title={`context ${contextTokens(u).toLocaleString()} (input ${u.input ?? 0}, cache read ${u.cacheRead ?? 0}, cache write ${u.cacheWrite ?? 0}) · output ${u.output ?? 0}`}>
          {fmtTokens(contextTokens(u))} ctx / {fmtTokens(u.output)} out
        </span>
      )}
      {r.cost != null && <span title="Estimated cost">{fmtCost(r.cost)}</span>}
      {r.stop_reason && r.stop_reason !== "end_turn" && r.stop_reason !== "tool_use" && <span className="chip">{r.stop_reason}</span>}
      <button className="link" title="Inspect this request in the Raw view" onClick={() => onOpenRequest(r.id)}>
        req {ordinal}
      </button>
    </span>
  );
}

function Section({ label, title, count, children }: { label: string; title: string; count?: string; children: React.ReactNode }) {
  return (
    <LazyDetails
      className="section"
      summary={
        <>
          <span className="gutter">
            <span className="role-label">{label}</span>
          </span>
          <span>
            {title} {count && <span className="muted">· {count}</span>}
          </span>
        </>
      }
    >
      <div className="section-body">{children}</div>
    </LazyDetails>
  );
}

// The system prompt is often several blocks (e.g. Anthropic's `system` array); keep them visibly separate.
function SystemBlocks({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 1) return <Blocks blocks={blocks} prose />;
  return (
    <>
      {blocks.map((b, i) => (
        <div key={i} className="sys-block">
          <Blocks blocks={[b]} prose />
        </div>
      ))}
    </>
  );
}

function Tools({ tools }: { tools: ToolDef[] }) {
  return (
    <div className="tools">
      {tools.map((t, i) => (
        <details key={i} className="tool-def">
          <summary>
            <code className={`tool-name cat-${category(t.name)}`}>{t.name}</code>
            {t.description && <span className="muted"> — {t.description.split("\n")[0]!.slice(0, 140)}</span>}
          </summary>
          {t.description && <Text text={t.description} fold />}
          {t.schema != null && <pre className="json">{JSON.stringify(t.schema, null, 2)}</pre>}
        </details>
      ))}
    </div>
  );
}

/** Highlight find matches with the CSS Custom Highlight API (no DOM changes, so React stays in charge). */
function highlight(root: HTMLElement | null, q: string, current: number) {
  const reg = (globalThis as any).CSS?.highlights as Map<string, unknown> | undefined;
  const H = (globalThis as any).Highlight as (new (...r: Range[]) => unknown) | undefined;
  if (!reg || !H) return;
  reg.delete("find");
  reg.delete("find-current");
  if (!root || !q) return;
  const all: Range[] = [];
  const cur: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.toLowerCase();
    if (!text) continue;
    const inCurrent = !!(node.parentElement?.closest(`[data-item="${current}"]`));
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
      const r = new Range();
      r.setStart(node, i);
      r.setEnd(node, i + q.length);
      (inCurrent ? cur : all).push(r);
      if (all.length + cur.length > 5000) break;
    }
  }
  reg.set("find", new H(...all));
  reg.set("find-current", new H(...cur));
}
