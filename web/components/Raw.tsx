import { useMemo, useState } from "react";
import type { RequestDetail } from "../api";

const STRING_CLAMP = 400;
const AUTO_OPEN_BYTES = 2000;

export function Raw({ detail }: { detail: RequestDetail }) {
  return (
    <div className="raw">
      <RawSection title="Request headers" text={JSON.stringify(detail.request_headers)} />
      <RawSection title="Request body" text={detail.request_body} open />
      <RawSection title="Response headers" text={JSON.stringify(detail.response_headers)} />
      <RawSection title="Response body" text={detail.response_body} open />
      <RawSection title="Normalized (llmview's parsed model)" text={JSON.stringify(detail.normalized)} />
    </div>
  );
}

function RawSection({ title, text, open = false }: { title: string; text: string | null; open?: boolean }) {
  const parsed = useMemo(() => {
    if (text == null) return { ok: false as const };
    try {
      return { ok: true as const, value: JSON.parse(text) };
    } catch {
      return { ok: false as const };
    }
  }, [text]);
  const [mode, setMode] = useState<"tree" | "text">("tree");
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => (parsed.ok ? JSON.stringify(parsed.value, null, 2) : (text ?? "")), [parsed, text]);

  const copy = async () => {
    await navigator.clipboard.writeText(pretty);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <details className="raw-section" open={open}>
      <summary>
        {title} <span className="muted">· {text == null ? "none" : fmtBytes(text.length)}</span>
      </summary>
      {text != null && (
        <>
          <div className="raw-toolbar">
            {parsed.ok && (
              <div className="tabs">
                <button className={mode === "tree" ? "on" : ""} onClick={() => setMode("tree")}>
                  Tree
                </button>
                <button className={mode === "text" ? "on" : ""} onClick={() => setMode("text")} title="Full pretty-printed text, searchable with Cmd+F">
                  Text
                </button>
              </div>
            )}
            <button className="ghost" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {parsed.ok && mode === "tree" ? (
            <div className="json-tree">
              <JsonNode value={parsed.value} depth={0} />
            </div>
          ) : (
            <pre className="raw-text">{pretty}</pre>
          )}
        </>
      )}
    </details>
  );
}

function JsonNode({ name, value, depth }: { name?: string | number; value: unknown; depth: number }) {
  const label = name !== undefined && <span className="jt-key">{typeof name === "number" ? name : JSON.stringify(name)}: </span>;

  if (value === null || typeof value !== "object") {
    return (
      <div className="jt-row">
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  return <Container name={label} value={value as object} depth={depth} />;
}

function Container({ name, value, depth }: { name: React.ReactNode; value: object; depth: number }) {
  const isArray = Array.isArray(value);
  const entries = isArray ? (value as unknown[]).map((v, i) => [i, v] as const) : Object.entries(value);
  // Open the root and small top-level values; everything else starts collapsed so big bodies stay navigable.
  const [open, setOpen] = useState(() => depth === 0 || (depth === 1 && JSON.stringify(value).length < AUTO_OPEN_BYTES));
  const summary = isArray ? `[${entries.length}]` : `{${entries.length} ${entries.length === 1 ? "key" : "keys"}}`;
  const preview = !open && !isArray ? previewOf(value as Record<string, unknown>) : "";

  return (
    <div className="jt-node">
      <div className="jt-row jt-toggle" onClick={() => setOpen(!open)}>
        <span className="jt-caret">{open ? "▾" : "▸"}</span>
        {name}
        <span className="jt-summary">{summary}</span>
        {preview && <span className="jt-preview">{preview}</span>}
      </div>
      {open && (
        <div className="jt-children">
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
          {!entries.length && <div className="jt-row muted">(empty)</div>}
        </div>
      )}
    </div>
  );
}

/** One-line hint for a collapsed object, e.g. `type: "text", text: "You are…"` */
function previewOf(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || typeof v !== "object") {
      const s = typeof v === "string" ? JSON.stringify(v.length > 60 ? v.slice(0, 60) + "…" : v) : String(v);
      parts.push(`${k}: ${s}`);
    }
    if (parts.length >= 3) break;
  }
  return parts.join(", ");
}

function Primitive({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  if (typeof value !== "string") return <span className={`jt-${value === null ? "null" : typeof value}`}>{String(value)}</span>;
  const long = value.length > STRING_CLAMP;
  const shown = long && !expanded ? value.slice(0, STRING_CLAMP) + "…" : value;
  return (
    <span className="jt-string">
      "{shown}"
      {long && (
        <button className="link jt-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? "less" : `show all ${fmtBytes(value.length)}`}
        </button>
      )}
    </span>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
