import { createContext, useContext, useMemo, useState } from "react";
import type { Block } from "../api";
import { type Boundary, boundaryOf, type ToolResult } from "../transcript/items";
import { clampMarkdown, Markdown, MarkdownMode } from "./Markdown";
import { Parallel, ToolCall } from "./ToolCall";

const CLAMP = 1600;

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
    case "text": {
      const boundary = prose ? boundaryOf(b.text) : undefined;
      return boundary ? <BoundaryCard boundary={boundary} /> : <Text text={b.text} markdown={prose} />;
    }
    case "thinking":
      return (
        <LazyDetails className="thinking" summary={b.redacted || !b.text ? "Thinking (not returned by the API)" : `Thinking · ${b.text.length.toLocaleString()} chars`}>
          {b.text && <Text text={b.text} markdown />}
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

/** Context an agent injected (reminders, slash-command echoes, hook output), kept out of the way. */
export function BoundaryCard({ boundary: b }: { boundary: Boundary }) {
  return (
    <LazyDetails
      className="boundary"
      summary={
        <>
          <span className="b-label">{b.label}</span>
          <span className="b-preview">{firstLine(b.body)}</span>
        </>
      }
    >
      <Text text={b.body} />
    </LazyDetails>
  );
}

export const firstLine = (text: string) => text.trim().split("\n")[0]!.slice(0, 200);

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

export function Text({ text, markdown = false }: { text: string; markdown?: boolean }) {
  const [open, setOpen] = useState(false);
  const enabled = useContext(MarkdownMode);
  const force = useContext(ForceOpen);
  const long = text.length > CLAMP;
  const md = markdown && enabled;
  const full = !long || open || force;
  const shown = useMemo(() => (full ? text : md ? clampMarkdown(text, CLAMP) : text.slice(0, CLAMP) + "…"), [text, full, md]);
  return (
    <div className="text">
      {md ? <Markdown text={shown} /> : <pre>{shown}</pre>}
      {long && !force && (
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all (${text.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}
