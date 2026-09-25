import { createContext, useContext, useMemo, useState } from "react";
import type { Block } from "../api";
import { nextFence } from "../transcript/fence";
import type { ToolResult } from "../transcript/items";
import { parseXml, type XmlElement, type XmlNode } from "../transcript/xml";
import { clampMarkdown, Formatted, Markdown } from "./Markdown";
import { Parallel, ToolCall } from "./ToolCall";

const CLAMP = 1600;
/** What a collapsed XML section counts for when deciding to clamp. */
const SECTION_COST = 80;

/** What blocks need to know about the thread they sit in. */
export interface ThreadInfo {
  /** tool_use id → its result, so calls show their output inline. */
  results: Map<string, ToolResult>;
  /** tool_use id → tool name, for results whose call isn't in view. */
  toolNames: Map<string, string>;
  /** True while the response is streaming, so its calls show as awaiting. */
  pending: boolean;
}

export const Thread = createContext<ThreadInfo>({ results: new Map(), toolNames: new Map(), pending: false });

/** Open every collapsible inside, e.g. for the current find match. */
export const ForceOpen = createContext(false);

/** `prose`: text blocks are conversation text (markdown-able) rather than tool output. */
export function Blocks({ blocks, prose = false, live = false }: { blocks: Block[]; prose?: boolean; live?: boolean }) {
  // Consecutive calls in one message run in parallel; bracket them.
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type === "tool_use" && blocks[i + 1]?.type === "tool_use") {
      const run: Block[] = [];
      while (blocks[i]?.type === "tool_use") run.push(blocks[i++]!);
      i--;
      out.push(
        <Parallel key={i} count={run.length}>
          {run.map((c, j) => (
            <BlockView key={j} block={c} prose={prose} live={live} />
          ))}
        </Parallel>,
      );
    } else out.push(<BlockView key={i} block={b} prose={prose} live={live} />);
  }
  return <>{out}</>;
}

function BlockView({ block: b, prose, live }: { block: Block; prose: boolean; live: boolean }) {
  const thread = useContext(Thread);
  switch (b.type) {
    case "text":
      return <Text text={b.text} markdown={prose} fold />;
    case "thinking":
      return (
        <LazyDetails className="thinking" summary={b.redacted || !b.text ? "Thinking (not returned by the API)" : `Thinking · ${b.text.length.toLocaleString()} chars`}>
          {b.text && <Text text={b.text} markdown fold />}
        </LazyDetails>
      );
    case "tool_use":
      return <ToolCall block={b} result={b.id ? thread.results.get(b.id) : undefined} awaiting={live && thread.pending} />;
    case "tool_result": {
      // Only results whose call isn't in this thread get here; paired ones render under their call.
      const name = b.name ?? (b.toolUseId ? thread.toolNames.get(b.toolUseId) : undefined);
      return (
        <LazyDetails
          className={`tool-card result ${b.isError ? "is-error" : ""}`}
          summary={
            <span className="tool-head">
              <span className="tool-icon">←</span> {name ? <code className="tool-name">{name}</code> : "result"}
              {b.isError && <span className="chip bad">error</span>}
              <span className="tool-preview">{firstLine(b.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"))}</span>
            </span>
          }
        >
          {b.toolUseId && (
            <a
              className="muted mono tool-id"
              href={`#tool-${b.toolUseId}`}
              onClick={() => document.getElementById(`tool-${b.toolUseId}`)?.setAttribute("open", "")}
            >
              {b.toolUseId}
            </a>
          )}
          <Blocks blocks={b.content} />
        </LazyDetails>
      );
    }
    case "image":
      return b.source?.startsWith("data:") || b.source?.startsWith("http") ? (
        <img className="img" src={b.source} alt={b.mediaType ?? "image"} />
      ) : (
        <div className="muted">
          [image {b.mediaType ?? ""} {b.source ?? ""}]
        </div>
      );
    case "raw":
      return (
        <details className="raw-block" open={JSON.stringify(b.data).length < 400}>
          <summary>{b.label ?? "data"}</summary>
          <pre className="json">{typeof b.data === "string" ? b.data : JSON.stringify(b.data, null, 2)}</pre>
        </details>
      );
  }
}

const firstLine = (text: string) => text.trim().split("\n")[0]!.slice(0, 200);

/** A <details> whose body is only rendered once it has been opened. */
export function LazyDetails({
  className,
  id,
  summary,
  children,
  open,
  ...data
}: {
  className: string;
  id?: string;
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  [k: `data-${string}`]: string | undefined;
}) {
  const force = useContext(ForceOpen);
  const [seen, setSeen] = useState(false);
  return (
    <details className={className} id={id} open={force || open || undefined} onToggle={(e) => e.currentTarget.open && setSeen(true)} {...data}>
      <summary>{summary}</summary>
      {(seen || open || force) && children}
    </details>
  );
}

/**
 * Text, with XML sections folded when formatting is on and `fold` is set; tool args don't fold.
 * `markdown` renders the prose as markdown.
 */
export function Text({
  text,
  markdown = false,
  fold,
}: {
  text: string;
  markdown?: boolean;
  fold?: boolean;
}) {
  const formatted = useContext(Formatted);
  const nodes = useMemo(
    () => (!formatted || !fold ? [text] : parseXml(text)),
    [text, formatted, fold],
  );
  const md = markdown && formatted;
  // The prose between sections renders as separate markdown documents; each needs the whole text's link definitions.
  const defs = useMemo(() => (md && nodes.some((n) => typeof n !== "string") ? linkDefs(text) : []), [md, nodes, text]);
  return <Nodes nodes={nodes} markdown={md} defs={defs} />;
}

const LINK_DEF = /^[ \t]*\[\^?[^\]\n]+\]:[ \t]*\S/;

/** Link reference and footnote definition lines outside code fences (a footnote's first line only). */
function linkDefs(text: string): string[] {
  const defs: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const next = nextFence(fence, line);
    if (fence == null && next == null && LINK_DEF.test(line)) defs.push(line.trim());
    fence = next;
  }
  return defs;
}

function withDefs(text: string, defs: string[]): string {
  const missing = defs.filter((d) => !text.includes(d));
  return missing.length ? `${text}\n\n${missing.join("\n")}` : text;
}

function Nodes({ nodes, markdown, defs }: { nodes: XmlNode[]; markdown: boolean; defs: string[] }) {
  const [open, setOpen] = useState(false);
  const force = useContext(ForceOpen);
  const long = nodes.reduce((a, n) => a + (typeof n === "string" ? n.length : SECTION_COST), 0) > CLAMP;
  const full = !long || open || force;
  const shown = useMemo(() => (full ? nodes : clampNodes(nodes, markdown)), [nodes, full, markdown]);
  return (
    <div className="text">
      {shown.map((n, i) =>
        typeof n !== "string" ? (
          <XmlSection key={i} el={n} markdown={markdown} defs={defs} />
        ) : markdown ? (
          <Markdown key={i} text={withDefs(n, defs)} />
        ) : (
          <pre key={i}>{n}</pre>
        ),
      )}
      {long && !force && (
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all (${sizeLabel(nodes)})`}
        </button>
      )}
    </div>
  );
}

/** The prose chars and folded sections the nodes hold, e.g. "1,200 chars, 3 sections". */
function sizeLabel(nodes: XmlNode[]): string {
  const chars = nodes.reduce((a, n) => a + (typeof n === "string" ? n.length : 0), 0);
  const sections = nodes.filter((n) => typeof n !== "string").length;
  const parts = [`${chars.toLocaleString()} chars`];
  if (sections) parts.push(`${sections.toLocaleString()} section${sections === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** Keep roughly CLAMP chars of prose; collapsed sections count as SECTION_COST and are never cut. */
function clampNodes(nodes: XmlNode[], markdown: boolean): XmlNode[] {
  const out: XmlNode[] = [];
  let budget = CLAMP;
  for (const n of nodes) {
    if (budget <= 0) break;
    if (typeof n !== "string") {
      out.push(n);
      budget -= SECTION_COST;
    } else if (n.length <= budget) {
      out.push(n);
      budget -= n.length;
    } else {
      out.push(markdown ? clampMarkdown(n, budget) : n.slice(0, budget) + "…");
      break;
    }
  }
  return out;
}

/** Longest one-line body shown beside its tag instead of folded. */
const INLINE_MAX = 120;

function XmlSection({ el, markdown, defs }: { el: XmlElement; markdown: boolean; defs: string[] }) {
  // Each tag is one text node, so find can highlight a search for it.
  const tag = <span className="x-tag">{`<${el.tag}${el.attrs.trimEnd()}>`}</span>;
  const [first] = el.children;
  // A short one-liner (<command-name>/clear</command-name>) reads better as a row than a fold.
  if (el.children.length <= 1 && (first == null || (typeof first === "string" && !first.includes("\n") && first.length <= INLINE_MAX))) {
    return (
      <div className="xml xml-inline">
        {tag}
        {first != null && <span className="x-value">{first}</span>}
      </div>
    );
  }
  const preview = typeof first === "string" ? firstLine(first) : `<${first!.tag}>`;
  return (
    <LazyDetails
      className="xml"
      summary={
        <>
          {tag}
          <span className="x-preview">{preview}</span>
        </>
      }
    >
      <div className="x-body">
        <button className="x-rail" aria-label={`Collapse <${el.tag}>`} title={`Collapse <${el.tag}>`} onClick={collapse} />
        <Nodes nodes={el.children} markdown={markdown} defs={defs} />
      </div>
    </LazyDetails>
  );
}

/** Close the section the rail belongs to, keeping its header in view. */
function collapse(e: React.MouseEvent<HTMLButtonElement>) {
  const details = e.currentTarget.closest("details")!;
  details.open = false;
  const summary = details.querySelector(":scope > summary")!;
  if (summary.getBoundingClientRect().top < 0) summary.scrollIntoView({ block: "nearest" });
  (summary as HTMLElement).focus({ preventScroll: true });
}
