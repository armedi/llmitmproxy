import { useMemo, useState } from "react";
import type { Block, Message, RequestDetail, ToolDef } from "../api";

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
        <Section title="System prompt" count={`${n.system.reduce((a, b) => a + (b.type === "text" ? b.text.length : 0), 0).toLocaleString()} chars`}>
          <Blocks blocks={n.system} toolNames={toolNames} />
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

      <div className="response">
        <div className="role-label">
          Response
          {detail.state === "pending" && (
            <span className="muted">
              {" "}
              · <span className="spinner" /> waiting for response…
            </span>
          )}
        </div>
        {n.response?.error && <div className="error-banner">{n.response.error}</div>}
        {n.response && n.response.blocks.length > 0 ? (
          <div className="msg assistant final">
            <Blocks blocks={n.response.blocks} toolNames={toolNames} />
          </div>
        ) : (
          detail.state !== "pending" && !n.response?.error && <div className="muted">(empty response)</div>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <details className="section">
      <summary>
        {title} {count && <span className="muted">· {count}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
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
      <Blocks blocks={message.content} toolNames={toolNames} />
    </div>
  );
}

function Blocks({ blocks, toolNames }: { blocks: Block[]; toolNames: Map<string, string> }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} toolNames={toolNames} />
      ))}
    </>
  );
}

function BlockView({ block: b, toolNames }: { block: Block; toolNames: Map<string, string> }) {
  switch (b.type) {
    case "text":
      return <Text text={b.text} />;
    case "thinking":
      return (
        <details className="thinking">
          <summary>{b.redacted || !b.text ? "Thinking (not returned by the API)" : `Thinking · ${b.text.length.toLocaleString()} chars`}</summary>
          {b.text && <Text text={b.text} />}
        </details>
      );
    case "tool_use":
      return (
        <div className="tool-card call" id={b.id ? `tool-${b.id}` : undefined}>
          <div className="tool-head">
            <span className="tool-icon">→</span> <code>{b.name}</code>
            {b.id && <span className="muted mono"> {b.id}</span>}
          </div>
          <ToolInput input={b.input} />
        </div>
      );
    case "tool_result": {
      const name = b.name ?? (b.toolUseId ? toolNames.get(b.toolUseId) : undefined);
      return (
        <div className={`tool-card result ${b.isError ? "is-error" : ""}`}>
          <div className="tool-head">
            <span className="tool-icon">←</span> {name ? <code>{name}</code> : "result"}
            {b.toolUseId && (
              <a className="muted mono" href={`#tool-${b.toolUseId}`}>
                {" "}
                {b.toolUseId}
              </a>
            )}
            {b.isError && <span className="chip bad">error</span>}
          </div>
          <Blocks blocks={b.content} toolNames={toolNames} />
        </div>
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

function Text({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP;
  return (
    <div className="text">
      <pre>{long && !open ? text.slice(0, CLAMP) + "…" : text}</pre>
      {long && (
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all (${text.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}
