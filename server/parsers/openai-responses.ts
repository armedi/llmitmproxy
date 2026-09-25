import type { Block, Message, Normalized, NormalizedResponse, Role, ToolDef } from "../types";
import { parseArgs, usage } from "./openai-chat";
import { sseJSON } from "./sse";

function contentBlocks(content: unknown): Block[] {
  if (content == null) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "raw", data: content }];
  return content.map((p: any): Block => {
    switch (p?.type) {
      case "input_text":
      case "output_text":
      case "text":
        return { type: "text", text: p.text ?? "" };
      case "refusal":
        return { type: "text", text: `[refusal] ${p.refusal}` };
      case "input_image":
        return { type: "image", source: p.image_url ?? p.file_id };
      default:
        return { type: "raw", label: p?.type, data: p };
    }
  });
}

function reasoningText(item: any): string {
  const parts = [...(item.summary ?? []), ...(item.content ?? [])];
  return parts.map((p: any) => p.text ?? "").filter(Boolean).join("\n\n");
}

/** Convert a list of Responses API items into messages, merging adjacent items of the same role. */
function itemsToMessages(items: any[]): Message[] {
  const out: Message[] = [];
  const push = (role: Role, blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role && role !== "user" && role !== "system") last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const it of items) {
    const type = it?.type ?? (it?.role ? "message" : undefined);
    switch (type) {
      case "message": {
        const role: Role = it.role === "assistant" ? "assistant" : it.role === "user" ? "user" : "system";
        push(role, contentBlocks(it.content));
        break;
      }
      case "reasoning": {
        const text = reasoningText(it);
        push("assistant", [{ type: "thinking", text, redacted: !text && !!it.encrypted_content }]);
        break;
      }
      case "function_call":
      case "custom_tool_call":
        push("assistant", [{ type: "tool_use", id: it.call_id ?? it.id, name: it.name, input: parseArgs(it.arguments ?? it.input) }]);
        break;
      case "local_shell_call":
        push("assistant", [{ type: "tool_use", id: it.call_id ?? it.id, name: "local_shell", input: it.action }]);
        break;
      case "function_call_output":
      case "custom_tool_call_output":
      case "local_shell_call_output": {
        const output = typeof it.output === "string" ? it.output : JSON.stringify(it.output);
        push("tool", [{ type: "tool_result", toolUseId: it.call_id, content: [{ type: "text", text: output }] }]);
        break;
      }
      default:
        if (typeof type === "string" && type.endsWith("_call")) {
          push("assistant", [{ type: "tool_use", id: it.id, name: type, input: it.action ?? it }]);
        } else {
          push("assistant", [{ type: "raw", label: type, data: it }]);
        }
    }
  }
  return out;
}

/** Flatten tool definitions; Codex groups its tools into `{ type: "namespace", name, tools }`. */
function toolDefs(tools: any[], ns?: string): ToolDef[] {
  return tools.flatMap((t: any): ToolDef[] => {
    if (t?.type === "namespace" && Array.isArray(t.tools)) return toolDefs(t.tools, t.name === "functions" ? ns : t.name);
    const name = t?.name ?? t?.type;
    return [
      {
        name: ns ? `${ns}.${name}` : name,
        description: t?.description,
        schema: t?.parameters ?? t?.format ?? (t?.type !== "function" ? { type: t?.type } : undefined),
      },
    ];
  });
}

export function parseRequest(req: any): Omit<Normalized, "response"> {
  const { model, instructions, input, tools, stream, previous_response_id, ...params } = req ?? {};
  // Codex's WebSocket requests send their tools as an `additional_tools` input item instead.
  const items: any[] = Array.isArray(input) ? input : [];
  const extra = items.filter((it) => it?.type === "additional_tools").flatMap((it) => it.tools ?? []);
  const defs = toolDefs([...(tools ?? []), ...extra]);
  let messages: Message[] =
    typeof input === "string"
      ? [{ role: "user", content: [{ type: "text", text: input }] }]
      : itemsToMessages(items.filter((it) => it?.type !== "additional_tools"));
  const system: Block[] = contentBlocks(instructions);
  // Leading system/developer messages belong with the instructions.
  while (messages[0]?.role === "system") system.push(...messages.shift()!.content);
  return {
    provider: "openai-responses",
    model,
    stream: !!stream,
    params,
    system,
    tools: defs,
    messages,
    previousResponseId: previous_response_id ?? undefined,
  };
}

function fromResponseObject(r: any): NormalizedResponse {
  if (r?.error && !r.output?.length) return { id: r.id, blocks: [], error: r.error.message ?? JSON.stringify(r.error) };
  const msgs = itemsToMessages(r?.output ?? []);
  return {
    id: r?.id,
    model: r?.model,
    blocks: msgs.flatMap((m) => m.content),
    stopReason: r?.incomplete_details?.reason ?? r?.status,
    usage: usage(r?.usage),
  };
}

export function parseResponseJSON(res: any): NormalizedResponse {
  if (res?.error && !res.output) return { blocks: [], error: res.error.message ?? JSON.stringify(res.error) };
  return fromResponseObject(res);
}

export function parseResponseSSE(body: string): NormalizedResponse {
  const events = sseJSON(body);
  const final = events.findLast((e) => ["response.completed", "response.incomplete", "response.failed"].includes(e.json?.type));
  if (final?.json?.response) {
    const out = fromResponseObject(final.json.response);
    // Some servers omit output in the completed event; rebuild it from output_item.done events.
    if (!out.blocks.length) out.blocks = rebuild(events);
    return out;
  }
  const created = events.find((e) => e.json?.type === "response.created")?.json?.response;
  const err = events.find((e) => e.json?.type === "error")?.json;
  return {
    id: created?.id,
    model: created?.model,
    blocks: rebuild(events),
    stopReason: "incomplete",
    error: err ? (err.message ?? err.error?.message ?? JSON.stringify(err)) : undefined,
  };
}

function rebuild(events: { json: any }[]): Block[] {
  const items: any[] = [];
  const text: Record<number, string> = {};
  for (const { json: e } of events) {
    if (e.type === "response.output_item.done") items[e.output_index] = e.item;
    else if (e.type === "response.output_text.delta") text[e.output_index] = (text[e.output_index] ?? "") + e.delta;
  }
  for (const [i, t] of Object.entries(text)) {
    items[+i] ??= { type: "message", role: "assistant", content: [{ type: "output_text", text: t }] };
  }
  return itemsToMessages(items.filter(Boolean)).flatMap((m) => m.content);
}
