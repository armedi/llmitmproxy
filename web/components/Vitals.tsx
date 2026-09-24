import { useMemo, useState } from "react";
import { fmtCost, fmtSeconds, fmtTokens, type RequestSummary, type Session } from "../api";
import { useNow } from "../hooks";
import { duration, vitals } from "../transcript/stats";
import { category } from "../transcript/tools";
import { Copy } from "./Copy";
import { PROVIDER_LABEL } from "./Sidebar";

interface Props {
  session: Session;
  requests: RequestSummary[];
  onOpenRequest: (id: number) => void;
}

/** Session-level numbers: time, tokens, cost, latency and tools. */
export function Vitals({ session, requests, onOpenRequest }: Props) {
  const v = useMemo(() => vitals(requests), [requests]);
  const now = useNow(1000, v.pending > 0);
  const end = v.pending > 0 ? now / 1000 : v.endedAt;
  const wall = v.startedAt != null && end != null ? end - v.startedAt : null;
  const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);

  return (
    <aside className="vitals">
      <VSection title="Session">
        <Grid>
          <Stat label="Duration" value={wall != null ? fmtSeconds(wall) : "–"} hint={v.pending ? "running…" : undefined} />
          <Stat label="Requests" value={String(v.requests)} hint={v.pending ? `${v.pending} in flight` : undefined} />
          <Stat label="Errors" value={String(v.errors)} bad={v.errors > 0} />
          <Stat label="API" value={PROVIDER_LABEL[session.provider] ?? session.provider} />
        </Grid>
        {session.session_id && (
          <div className="v-id" title={session.agent_id ? `Agent session id · subagent ${session.agent_id}` : "The agent's own session id"}>
            <span className="stat-label">Session ID</span>
            <code>{session.session_id}</code>
            <Copy text={session.session_id} />
          </div>
        )}
      </VSection>

      <VSection title="Tokens">
        <Grid>
          <Stat label="Context now" value={fmtTokens(v.currentContext)} />
          <Stat label="Peak context" value={fmtTokens(v.peakContext)} />
          <Stat label="Cache hit" value={pct(v.cacheHitRate)} hint="of input served from cache" />
          <Stat label="Output" value={fmtTokens(v.totals.output)} hint={v.totals.reasoning ? `${fmtTokens(v.totals.reasoning)} reasoning` : undefined} />
        </Grid>
        <TokenBreakdown totals={v.totals} />
        {v.contextSeries.length > 1 && <Sparkline values={v.contextSeries} label="Context size per request" />}
      </VSection>

      <VSection title="Cost" note="estimate">
        <Grid>
          <Stat label="This session" value={fmtCost(v.cost)} hint={v.unpriced ? `${v.unpriced} unpriced` : undefined} />
          {session.parent_id == null && session.child_count > 0 && <Stat label="With subagents" value={fmtCost(session.group_cost)} />}
        </Grid>
        {v.costByModel.length > 1 && (
          <table className="v-table">
            <tbody>
              {v.costByModel.map((m) => (
                <tr key={m.model}>
                  <td className="mono">{m.model}</td>
                  <td className="num muted">{m.requests} req</td>
                  <td className="num">{fmtCost(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </VSection>

      <VSection title="Latency">
        <Grid>
          <Stat label="Typical (p50)" value={v.p50 != null ? fmtSeconds(v.p50) : "–"} />
          <Stat label="Slow (p90)" value={v.p90 != null ? fmtSeconds(v.p90) : "–"} />
          <Stat label="Avg wait" value={v.avgHeaders != null ? fmtSeconds(v.avgHeaders) : "–"} hint="until the response starts" />
          <Stat
            label="Slowest"
            value={v.slowest ? fmtSeconds(duration(v.slowest)!) : "–"}
            hint={v.slowest ? `request ${requests.indexOf(v.slowest) + 1} · view raw ↗` : undefined}
            onClick={v.slowest ? () => onOpenRequest(v.slowest!.id) : undefined}
          />
        </Grid>
      </VSection>

      {v.tools.length > 0 && (
        <VSection title="Tool calls" note={`${v.tools.reduce((a, t) => a + t.count, 0)} total`}>
          <div className="bars">
            {v.tools.slice(0, 15).map((t) => (
              <button
                key={t.name}
                className="bar-row"
                title={`${t.name}: ${t.count} calls. Click to jump to the first one in view.`}
                onClick={() => {
                  const el = document.querySelector<HTMLDetailsElement>(`[data-tool="${CSS.escape(t.name)}"]`);
                  el?.scrollIntoView({ block: "center", behavior: "smooth" });
                }}
              >
                <span className="bar-label mono">{t.name}</span>
                <span className="bar-track">
                  <span className={`bar-fill cat-${category(t.name)}`} style={{ width: `${Math.max(4, (t.count / v.tools[0]!.count) * 100)}%` }} />
                </span>
                <span className="bar-value">{t.count}</span>
              </button>
            ))}
            {v.tools.length > 15 && <div className="muted small">+{v.tools.length - 15} more tools</div>}
          </div>
        </VSection>
      )}

    </aside>
  );
}

function VSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="v-section">
      <h3>
        {title} {note && <span className="muted">· {note}</span>}
      </h3>
      {children}
    </section>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="v-grid">{children}</div>;

function Stat({ label, value, hint, bad, onClick }: { label: string; value: string; hint?: string; bad?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`stat ${onClick ? "clickable" : ""}`} onClick={onClick}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${bad ? "bad" : ""}`}>{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </Tag>
  );
}

/** Where the prompt tokens went: uncached input, cache reads, cache writes. */
function TokenBreakdown({ totals: t }: { totals: { input: number; cacheRead: number; cacheWrite: number; output: number } }) {
  const parts = [
    { k: "input", label: "input", n: t.input },
    { k: "cache-read", label: "cache read", n: t.cacheRead },
    { k: "cache-write", label: "cache write", n: t.cacheWrite },
  ];
  const sum = parts.reduce((a, p) => a + p.n, 0);
  if (!sum) return null;
  return (
    <div className="stack">
      <div className="stack-bar" role="img" aria-label="Prompt tokens by kind">
        {parts
          .filter((p) => p.n)
          .map((p) => (
            <span key={p.k} className={`stack-seg ${p.k}`} style={{ flexGrow: p.n }} title={`${p.label}: ${p.n.toLocaleString()} (${Math.round((p.n / sum) * 100)}%)`} />
          ))}
      </div>
      <div className="stack-legend">
        {parts.map((p) => (
          <span key={p.k}>
            <span className={`swatch ${p.k}`} />
            {p.label} <b>{fmtTokens(p.n)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Context size per request, with a hover readout. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 260;
  const H = 48;
  const P = 5;
  const max = Math.max(...values, 1);
  const x = (i: number) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1)},${H - P}L${x(0)},${H - P}Z`;
  const shown = hover ?? values.length - 1;
  return (
    <figure className="spark">
      <figcaption>
        <span>{label}</span>
        <span className="muted">
          req {shown + 1}: <b>{fmtTokens(values[shown])}</b>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: from ${fmtTokens(values[0])} to ${fmtTokens(values[values.length - 1])}, peak ${fmtTokens(max)}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round((((e.clientX - r.left) / r.width) * W - P) / ((W - 2 * P) / Math.max(1, values.length - 1)));
          setHover(Math.max(0, Math.min(values.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line className="spark-base" x1={P} x2={W - P} y1={H - P} y2={H - P} />
        <path className="spark-area" d={area} />
        <path className="spark-line" d={line} />
        {hover != null && <line className="spark-cross" x1={x(hover)} x2={x(hover)} y1={P} y2={H - P} />}
        <circle className="spark-dot" cx={x(shown)} cy={y(values[shown]!)} r={4} />
      </svg>
    </figure>
  );
}
