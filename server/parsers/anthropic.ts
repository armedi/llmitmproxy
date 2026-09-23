import type { Block, Message, Normalized, NormalizedResponse, ToolDef, Usage } from "../types";
import { sseJSON } from "./sse";

function textBlocks(content: unknown): Block[] {
  if (content == null) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.map(block);
  return [{ type: "raw", data: content }];
}

function block(b: any): Block {
  if (!b || typeof b !== "object") return { type: "text", text: String(b) };
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text ?? "" };
    case "thinking":
      return { type: "thinking", text: b.thinking ?? "" };
    case "redacted_thinking":
      return { type: "thinking", text: "", redacted: true };
    case "tool_use":
    case "server_tool_use":
    case "mcp_tool_use":
      return { type: "tool_use", id: b.id, name: b.name ?? b.type, input: b.input };
    case "tool_result":
    case "mcp_tool_result":
      return {
        type: "tool_result",
        toolUseId: b.tool_use_id,
        content: textBlocks(b.content),
        isError: !!b.is_error,
      };
    case "image":
      return {
        type: "image",
        mediaType: b.source?.media_type,
        source: b.source?.type === "base64" ? `data:${b.source.media_type};base64,${b.source.data}` : b.source?.url,
      };
    default:
      if (typeof b.type === "string" && b.type.endsWith("_tool_result")) {
        return { type: "tool_result", toolUseId: b.tool_use_id, name: b.type, content: [{ type: "raw", data: b.content }] };
      }
      return { type: "raw", label: b.type, data: b };
  }
}

function usage(u: any): Usage | undefined {
  if (!u) return undefined;
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens,
    cacheWrite: u.cache_creation_input_tokens,
  };
}

/** Claude Code puts the session id in metadata.user_id, either as JSON or as `..._session_<uuid>`. */
function sessionHint(req: any): string | undefined {
  const uid = req?.metadata?.user_id;
  if (typeof uid !== "string") return undefined;
  try {
    const parsed = JSON.parse(uid);
    if (parsed?.session_id) return `claude:${parsed.session_id}`;
  } catch {
    // not JSON
  }
  const m = uid.match(/session_([0-9a-f-]{8,})/i);
  return m ? `claude:${m[1]}` : undefined;
}

export function parseRequest(req: any): Omit<Normalized, "response"> {
  const { model, system, messages, tools, metadata, stream, ...params } = req ?? {};
  const toolDefs: ToolDef[] = (tools ?? []).map((t: any) => ({
    name: t.name ?? t.type,
    description: t.description,
    schema: t.input_schema ?? (t.type ? { type: t.type } : undefined),
  }));
  const msgs: Message[] = (messages ?? []).map((m: any) => ({
    role: m.role === "assistant" || m.role === "system" ? m.role : "user",
    content: textBlocks(m.content),
  }));
  return {
    provider: "anthropic",
    model,
    stream: !!stream,
    params,
    system: textBlocks(system),
    tools: toolDefs,
    messages: msgs,
    sessionHint: sessionHint(req),
  };
}

export function parseResponseJSON(res: any): NormalizedResponse {
  if (res?.type === "error" || res?.error) {
    return { blocks: [], error: res.error?.message ?? JSON.stringify(res.error) };
  }
  return {
    id: res?.id,
    model: res?.model,
    blocks: (res?.content ?? []).map(block),
    stopReason: res?.stop_reason ?? undefined,
    usage: usage(res?.usage),
  };
}

export function parseResponseSSE(body: string): NormalizedResponse {
  const out: NormalizedResponse = { blocks: [] };
  const raw: any[] = [];
  const partialJSON: string[] = [];
  const closed = new Set<number>();
  let u: any = {};
  for (const { json: ev } of sseJSON(body)) {
    switch (ev.type) {
      case "message_start":
        out.id = ev.message?.id;
        out.model = ev.message?.model;
        u = { ...ev.message?.usage };
        break;
      case "content_block_start":
        raw[ev.index] = structuredClone(ev.content_block ?? {});
        partialJSON[ev.index] = "";
        break;
      case "content_block_delta": {
        const b = (raw[ev.index] ??= { type: "text", text: "" });
        const d = ev.delta ?? {};
        if (d.type === "text_delta") b.text = (b.text ?? "") + d.text;
        else if (d.type === "thinking_delta") b.thinking = (b.thinking ?? "") + d.thinking;
        else if (d.type === "input_json_delta") partialJSON[ev.index] = (partialJSON[ev.index] ?? "") + d.partial_json;
        else if (d.type === "signature_delta") b.signature = d.signature;
        break;
      }
      case "content_block_stop": {
        closed.add(ev.index);
        const pj = partialJSON[ev.index];
        if (pj) {
          try {
            raw[ev.index].input = JSON.parse(pj);
          } catch {
            raw[ev.index].input = pj;
          }
        }
        break;
      }
      case "message_delta":
        if (ev.delta?.stop_reason) out.stopReason = ev.delta.stop_reason;
        if (ev.usage) u = { ...u, ...Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v != null)) };
        break;
      case "error":
        out.error = ev.error?.message ?? JSON.stringify(ev.error);
        break;
    }
  }
  // Streams cut off before content_block_stop still carry partial tool input.
  partialJSON.forEach((pj, i) => {
    if (pj && raw[i] && !closed.has(i)) raw[i].input = pj;
  });
  out.blocks = raw.filter(Boolean).map(block);
  out.usage = usage(u);
  return out;
}
