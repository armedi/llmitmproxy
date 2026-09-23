import { useContext, useMemo, useState } from "react";
import type { Block, Message, RequestDetail, ToolDef } from "../api";
import { clampMarkdown, Markdown, MarkdownMode } from "./Markdown";

const CLAMP = 1600;

export function Conversation({ detail }: { detail: RequestDetail }) {
  const n = detail.normalized;
  const toolNames = useMemo(() => {
    const m = new Map<string, string>();
    const visit = (blocks: Block[]) => blocks.forEach((b) => b.type === "tool_use" && b.id && m.set(b.id, b.name));
    n.messages.forEach((msg) => visit(msg.content));
    if (n.response) visit(n.response.blocks);
    return m;
  }, [n]);

  const params = Object.entries(n.params ?? {}).filter(([, v]) => v !== undefined);

  return (
    <div className="conversation">
      {n.system.length > 0 && (
        <Section title="System prompt">
          <SystemBlocks blocks={n.system} toolNames={toolNames} />
        </Section>
      )}
      {n.tools.length > 0 && (
        <Section title="Tools" count={String(n.tools.length)}>
          <Tools tools={n.tools} />
        </Section>
      )}
      {params.length > 0 && (
        <Section title="Parameters" count={String(params.length)}>
          <pre className="json">{JSON.stringify(Object.fromEntries(params), null, 2)}</pre>
        </Section>
      )}

      {n.messages.map((m, i) => (
        <MessageView key={i} index={i} message={m} toolNames={toolNames} />
      ))}

      {(detail.state === "pending" || n.response) && (
        <div className="msg assistant">
          <div className="role-label">
            assistant <span className="muted">#{n.messages.length + 1}</span>
            {detail.state === "pending" && (
              <span className="muted">
                {" "}
                · <span className="spinner" /> responding…
              </span>
            )}
          </div>
          {n.response?.error && <div className="error-banner">{n.response.error}</div>}
          {n.response && n.response.blocks.length > 0 ? (
            <Blocks blocks={n.response.blocks} toolNames={toolNames} prose />
          ) : (
            detail.state !== "pending" && !n.response?.error && <div className="muted">(empty response)</div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <LazyDetails className="section" summary={<>{title} {count && <span className="muted">· {count}</span>}</>}>
      <div className="section-body">{children}</div>
    </LazyDetails>
  );
}

// The system prompt is often several blocks (e.g. Anthropic's `system` array); keep them visibly separate.
function SystemBlocks({ blocks, toolNames }: { blocks: Block[]; toolNames: Map<string, string> }) {
  if (blocks.length === 1) return <Blocks blocks={blocks} toolNames={toolNames} prose />;
  return (
    <>
      {blocks.map((b, i) => (
        <div key={i} className="sys-block">
          <BlockView block={b} toolNames={toolNames} prose />
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
            <code>{t.name}</code>
            {t.description && <span className="muted"> — {t.description.split("\n")[0]!.slice(0, 140)}</span>}
          </summary>
          {t.description && <Text text={t.description} />}
          {t.schema != null && <pre className="json">{JSON.stringify(t.schema, null, 2)}</pre>}
        </details>
      ))}
    </div>
  );
}

function MessageView({ message, index, toolNames }: { message: Message; index: number; toolNames: Map<string, string> }) {
  const onlyResults = message.content.length > 0 && message.content.every((b) => b.type === "tool_result");
  const role = onlyResults ? "tool" : message.role;
  return (
    <div className={`msg ${role}`}>
      <div className="role-label">
        {role} <span className="muted">#{index + 1}</span>
      </div>
      <Blocks blocks={message.content} toolNames={toolNames} prose />
    </div>
  );
}

/** `prose`: text blocks are conversation text (markdown-able) rather than tool output. */
function Blocks({ blocks, toolNames, prose = false }: { blocks: Block[]; toolNames: Map<string, string>; prose?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} toolNames={toolNames} prose={prose} />
      ))}
    </>
  );
}

function BlockView({ block: b, toolNames, prose }: { block: Block; toolNames: Map<string, string>; prose: boolean }) {
  switch (b.type) {
    case "text":
      return <Text text={b.text} markdown={prose} />;
    case "thinking":
      return (
        <LazyDetails
          className="thinking"
          summary={b.redacted || !b.text ? "Thinking (not returned by the API)" : "Thinking"}
        >
          {b.text && <Text text={b.text} markdown />}
        </LazyDetails>
      );
    case "tool_use":
      return (
        <LazyDetails
          className="tool-card call"
          id={b.id ? `tool-${b.id}` : undefined}
          summary={
            <span className="tool-head">
              <span className="tool-icon">→</span> <code>{b.name}</code>
              <span className="tool-preview">{inputPreview(b.input)}</span>
            </span>
          }
        >
          {b.id && <div className="muted mono tool-id">{b.id}</div>}
          <ToolInput input={b.input} />
        </LazyDetails>
      );
    case "tool_result": {
      const name = b.name ?? (b.toolUseId ? toolNames.get(b.toolUseId) : undefined);
      return (
        <LazyDetails
          className={`tool-card result ${b.isError ? "is-error" : ""}`}
          summary={
            <span className="tool-head">
              <span className="tool-icon">←</span> {name ? <code>{name}</code> : "result"}
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
          <Blocks blocks={b.content} toolNames={toolNames} />
        </LazyDetails>
      );
    }
    case "image":
      return b.source?.startsWith("data:") || b.source?.startsWith("http") ? (
        <img className="img" src={b.source} alt={b.mediaType ?? "image"} />
      ) : (
        <div className="muted">[image {b.mediaType ?? ""} {b.source ?? ""}]</div>
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

/** One-line hint for a collapsed tool call: its description, or else its first string argument. */
function inputPreview(input: unknown): string {
  if (typeof input === "string") return firstLine(input);
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const s = typeof o.description === "string" ? o.description : Object.values(o).find((v): v is string => typeof v === "string");
  return s ? firstLine(s) : "";
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

/** A <details> whose body is only rendered once it has been opened. */
function LazyDetails({ className, id, summary, children }: { className: string; id?: string; summary: React.ReactNode; children: React.ReactNode }) {
  const [seen, setSeen] = useState(false);
  return (
    <details className={className} id={id} onToggle={(e) => e.currentTarget.open && setSeen(true)}>
      <summary>{summary}</summary>
      {seen && children}
    </details>
  );
}

function Text({ text, markdown = false }: { text: string; markdown?: boolean }) {
  const [open, setOpen] = useState(false);
  const enabled = useContext(MarkdownMode);
  const long = text.length > CLAMP;
  const md = markdown && enabled;
  const shown = useMemo(() => (!long || open ? text : md ? clampMarkdown(text, CLAMP) : text.slice(0, CLAMP) + "…"), [text, long, open, md]);
  return (
    <div className="text">
      {md ? (
        <Markdown text={shown} />
      ) : (
        <pre>{shown}</pre>
      )}
      {long && (
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all (${text.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}
