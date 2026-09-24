import { useMemo, useState } from "react";
import { contextTokens, fmtCost, fmtSeconds, fmtTime, fmtTokens, type RequestSummary, type Session } from "../api";
import { useNow } from "../hooks";
import { duration, vitals } from "../transcript/stats";
import { category } from "../transcript/tools";

interface Props {
  session: Session;
  requests: RequestSummary[];
  /** The request shown in the transcript. */
  viewing: number | null;
  onOpenRequest: (id: number) => void;
}

/** Session-level numbers: time, tokens, cost, latency, tools, and every request. */
export function Vitals({ session, requests, viewing, onOpenRequest }: Props) {
  const v = useMemo(() => vitals(requests), [requests]);
  const now = useNow(1000, v.pending > 0);
  const end = v.pending > 0 ? now / 1000 : v.endedAt;
  const wall = v.startedAt != null && end != null ? end - v.startedAt : null;
  const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);

  return (
    <aside className="vitals">
      <VSection title="Session">
        <Grid>
          <Stat label="Wall clock" value={wall != null ? fmtSeconds(wall) : "–"} hint={v.pending ? "running…" : undefined} />
          <Stat label="Requests" value={String(v.requests)} hint={v.pending ? `${v.pending} in flight` : undefined} />
          <Stat label="Errors" value={String(v.errors)} bad={v.errors > 0} />
          <Stat label="Started" value={v.startedAt ? fmtTime(v.startedAt) : "–"} />
          {session.client && <Stat label="Client" value={session.client} />}
          <Stat label="API" value={session.provider} />
        </Grid>
      </VSection>

      <VSection title="Tokens">
        <Grid>
          <Stat label="Context now" value={fmtTokens(v.currentContext)} />
          <Stat label="Peak context" value={fmtTokens(v.peakContext)} />
          <Stat label="Cache hit" value={pct(v.cacheHitRate)} hint="cache read ÷ prompt" />
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
          <Stat label="p50" value={v.p50 != null ? fmtSeconds(v.p50) : "–"} />
          <Stat label="p90" value={v.p90 != null ? fmtSeconds(v.p90) : "–"} />
          <Stat label="Avg to headers" value={v.avgHeaders != null ? fmtSeconds(v.avgHeaders) : "–"} hint="time until response headers" />
          <Stat
            label="Slowest"
            value={v.slowest ? fmtSeconds(duration(v.slowest)!) : "–"}
            hint={v.slowest ? `request ${requests.indexOf(v.slowest) + 1} ↗` : undefined}
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

      <VSection title="Requests" note="click to open">
        <div className="req-list">
          {requests.map((r, i) => {
            const d = duration(r);
            const bad = r.state === "error" || (r.status ?? 0) >= 400;
            return (
              <button key={r.id} className={`req-row ${r.id === viewing ? "on" : ""}`} onClick={() => onOpenRequest(r.id)} title={requestTitle(r, i)}>
                <span className="req-n muted">{i + 1}</span>
                <span className="req-main">
                  <span className="req-line">
                    {r.state === "pending" ? (
                      <span className="chip pending">
                        <span className="spinner" />
                        in flight
                      </span>
                    ) : bad ? (
                      <span className="chip bad">{r.status ?? "error"}</span>
                    ) : null}
                    <span className="req-tools">{r.tool_calls.length ? r.tool_calls.join(", ") : (r.stop_reason ?? "")}</span>
                    <span className="spacer" />
                    <span className="muted">{r.usage ? `${fmtTokens(contextTokens(r.usage))}/${fmtTokens(r.usage.output)}` : ""}</span>
                  </span>
                  <span className="req-line">
                    <span className="bar-track">
                      <span className={`bar-fill ${bad ? "bad" : r.state === "pending" ? "pending" : "dur"}`} style={{ width: `${d != null && v.longest ? Math.max(4, (d / v.longest) * 100) : 4}%` }} />
                    </span>
                    <span className="bar-value">{d != null ? fmtSeconds(d) : "…"}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </VSection>
    </aside>
  );
}

function requestTitle(r: RequestSummary, i: number) {
  const u = r.usage;
  return [
    `Request ${i + 1} · ${fmtTime(r.started_at)}`,
    r.model,
    r.stop_reason && `stop: ${r.stop_reason}`,
    u && `input ${u.input ?? 0} · cache read ${u.cacheRead ?? 0} · cache write ${u.cacheWrite ?? 0} · output ${u.output ?? 0}`,
    r.cost != null && `cost ${fmtCost(r.cost)}`,
    r.response_started_at && `headers after ${fmtSeconds(r.response_started_at - r.started_at)}`,
    r.error,
  ]
    .filter(Boolean)
    .join("\n");
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
