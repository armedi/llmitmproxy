import type { Block, Message, Normalized, NormalizedResponse, Role, ToolDef, Usage } from "../types";
import { sseJSON } from "./sse";

export function parseArgs(args: unknown): unknown {
  if (typeof args !== "string") return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

function contentBlocks(content: unknown): Block[] {
  if (content == null || content === "") return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "raw", data: content }];
  return content.map((p: any): Block => {
    switch (p?.type) {
      case "text":
        return { type: "text", text: p.text ?? "" };
      case "image_url":
        return { type: "image", source: typeof p.image_url === "string" ? p.image_url : p.image_url?.url };
      case "refusal":
        return { type: "text", text: `[refusal] ${p.refusal}` };
      default:
        return { type: "raw", label: p?.type, data: p };
    }
  });
}

function toolCalls(calls: any[] | undefined): Block[] {
  return (calls ?? []).map((c) => ({
    type: "tool_use",
    id: c.id,
    name: c.function?.name ?? c.type ?? "tool",
    input: parseArgs(c.function?.arguments ?? c.custom?.input),
  }));
}

function assistantBlocks(m: any): Block[] {
  const blocks: Block[] = [];
  const reasoning = m.reasoning_content ?? m.reasoning;
  if (typeof reasoning === "string" && reasoning) blocks.push({ type: "thinking", text: reasoning });
  blocks.push(...contentBlocks(m.content));
  if (m.refusal) blocks.push({ type: "text", text: `[refusal] ${m.refusal}` });
  blocks.push(...toolCalls(m.tool_calls));
  if (m.function_call) blocks.push(...toolCalls([{ function: m.function_call }]));
  return blocks;
}

export function usage(u: any): Usage | undefined {
  if (!u) return undefined;
  return {
    input: u.prompt_tokens ?? u.input_tokens,
    output: u.completion_tokens ?? u.output_tokens,
    cacheRead: u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens,
    reasoning: u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens,
    total: u.total_tokens,
  };
}

export function parseRequest(req: any): Omit<Normalized, "response"> {
  const { model, messages, tools, functions, stream, stream_options, ...params } = req ?? {};
  const system: Block[] = [];
  const msgs: Message[] = [];
  for (const m of messages ?? []) {
    const role: string = m.role;
    if ((role === "system" || role === "developer") && msgs.length === 0) {
      system.push(...contentBlocks(m.content));
      continue;
    }
    if (role === "assistant") {
      msgs.push({ role: "assistant", content: assistantBlocks(m) });
    } else if (role === "tool" || role === "function") {
      msgs.push({
        role: "tool",
        content: [{ type: "tool_result", toolUseId: m.tool_call_id, name: m.name, content: contentBlocks(m.content) }],
      });
    } else {
      msgs.push({ role: (role === "developer" ? "system" : role) as Role, content: contentBlocks(m.content) });
    }
  }
  const toolDefs: ToolDef[] = [
    ...(tools ?? []).map((t: any) => ({
      name: t.function?.name ?? t.name ?? t.type,
      description: t.function?.description ?? t.description,
      schema: t.function?.parameters ?? t.parameters,
    })),
    ...(functions ?? []).map((f: any) => ({ name: f.name, description: f.description, schema: f.parameters })),
  ];
  return {
    provider: "openai-chat",
    model,
    stream: !!stream,
    params,
    system,
    tools: toolDefs,
    messages: msgs,
  };
}

export function parseResponseJSON(res: any): NormalizedResponse {
  if (res?.error) return { blocks: [], error: res.error.message ?? JSON.stringify(res.error) };
  const choice = res?.choices?.[0];
  return {
    id: res?.id,
    model: res?.model,
    blocks: choice?.message ? assistantBlocks(choice.message) : [],
    stopReason: choice?.finish_reason ?? undefined,
    usage: usage(res?.usage),
  };
}

export function parseResponseSSE(body: string): NormalizedResponse {
  const out: NormalizedResponse = { blocks: [] };
  const msg: any = { content: "", reasoning_content: "", tool_calls: [] as any[] };
  for (const { json: ch } of sseJSON(body)) {
    if (ch.error) {
      out.error = ch.error.message ?? JSON.stringify(ch.error);
      continue;
    }
    out.id ??= ch.id;
    out.model ??= ch.model;
    if (ch.usage) out.usage = usage(ch.usage);
    const choice = ch.choices?.find((c: any) => (c.index ?? 0) === 0);
    if (!choice) continue;
    const d = choice.delta ?? {};
    if (typeof d.content === "string") msg.content += d.content;
    const r = d.reasoning_content ?? d.reasoning;
    if (typeof r === "string") msg.reasoning_content += r;
    if (d.refusal) msg.refusal = (msg.refusal ?? "") + d.refusal;
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? msg.tool_calls.length;
      const cur = (msg.tool_calls[i] ??= { id: undefined, type: "function", function: { name: "", arguments: "" } });
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
    }
    if (choice.finish_reason) out.stopReason = choice.finish_reason;
  }
  msg.tool_calls = msg.tool_calls.filter(Boolean);
  out.blocks = assistantBlocks(msg);
  return out;
}
