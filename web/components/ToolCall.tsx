import { useState } from "react";
import type { Block } from "../api";
import { type DiffLine, toolDiff } from "../transcript/diff";
import { resultText, type ToolResult } from "../transcript/items";
import { category, commandOf, resultHint, summarize } from "../transcript/tools";
import { Copy } from "./Copy";
import { Blocks, LazyDetails, Text } from "./Blocks";

type ToolUse = Extract<Block, { type: "tool_use" }>;

/** A tool call with its result underneath, collapsed to a one-line summary. */
export function ToolCall({ block: b, result, awaiting }: { block: ToolUse; result?: ToolResult; awaiting?: boolean }) {
  const cat = category(b.name);
  const summary = summarize(b.name, b.input);
  const diff = toolDiff(b.name, b.input);
  const cmd = commandOf(b.input);
  const out = result ? resultText(result) : "";
  return (
    <LazyDetails
      className={`tool-card call cat-${cat} ${result?.isError ? "is-error" : ""}`}
      id={b.id ? `tool-${b.id}` : undefined}
      data-tool={b.name}
      summary={
        <span className="tool-head">
          <code className="tool-name">{b.name}</code>
          <span className="tool-preview" title={summary}>
            {summary}
          </span>
          <span className="tool-tail">
            {result?.isError && <span className="chip bad">error</span>}
            {result && !result.isError && out && <span className="muted mono">{resultHint(out)}</span>}
            {!result && awaiting && (
              <span className="muted">
                <span className="spinner" />
                awaiting result
              </span>
            )}
          </span>
        </span>
      }
    >
      <div className="tool-meta">
        {b.id && <span className="muted mono tool-id">{b.id}</span>}
        <span className="spacer" />
        {cmd && <Copy text={cmd} label="Copy command" />}
        <Copy text={() => (typeof b.input === "string" ? b.input : JSON.stringify(b.input, null, 2))} label="Copy input" />
      </div>
      {diff ? <DiffInput lines={diff} input={b.input} /> : <ToolInput input={b.input} />}
      {result && (
        <LazyDetails
          className={`tool-output ${result.isError ? "is-error" : ""}`}
          open={out.length > 0 && out.length < 600}
          summary={
            <>
              Output <span className="muted">· {out ? `${out.length.toLocaleString()} chars` : "empty"}</span>
            </>
          }
        >
          <div className="tool-meta">
            <span className="spacer" />
            <Copy text={out} label="Copy output" />
          </div>
          <Blocks blocks={result.content} />
        </LazyDetails>
      )}
    </LazyDetails>
  );
}

/** Two or more calls from one message run in parallel. */
export function Parallel({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="parallel">
      <div className="parallel-head">Parallel · {count} calls</div>
      {children}
    </div>
  );
}

function DiffInput({ lines, input }: { lines: DiffLine[]; input: unknown }) {
  const [args, setArgs] = useState(false);
  return (
    <>
      <div className="tool-meta">
        <div className="tabs small">
          <button className={args ? "" : "on"} onClick={() => setArgs(false)}>
            Diff
          </button>
          <button className={args ? "on" : ""} onClick={() => setArgs(true)}>
            Args
          </button>
        </div>
      </div>
      {args ? <ToolInput input={input} /> : <Diff lines={lines} />}
    </>
  );
}

const DIFF_CLAMP = 400;

export function Diff({ lines }: { lines: DiffLine[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, DIFF_CLAMP);
  const sign = { add: "+", del: "-", ctx: " ", hunk: "", file: "" } as const;
  return (
    <div className="diff">
      {shown.map((l, i) => (
        <div key={i} className={`dl ${l.kind}`}>
          <span className="dl-sign">{sign[l.kind]}</span>
          {l.text || " "}
        </div>
      ))}
      {lines.length > DIFF_CLAMP && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${lines.length.toLocaleString()} lines`}
        </button>
      )}
    </div>
  );
}

function ToolInput({ input }: { input: unknown }) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const entries = Object.entries(input);
    // Show short scalar args inline and long strings (commands, file contents) as text.
    return (
      <div className="tool-args">
        {entries.map(([k, v]) => (
          <div key={k} className="arg">
            <span className="arg-key">{k}</span>
            {typeof v === "string" ? <Text text={v} /> : <pre className="json">{JSON.stringify(v, null, 2)}</pre>}
          </div>
        ))}
      </div>
    );
  }
  return <pre className="json">{typeof input === "string" ? input : JSON.stringify(input, null, 2)}</pre>;
}
