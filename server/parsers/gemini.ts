import type { Block, Message, Normalized, NormalizedResponse, ToolDef, Usage } from "../types";
import { sseJSON } from "./sse";

// Gemini accepts both camelCase and snake_case field names.
const pick = (o: any, camel: string, snake: string) => o?.[camel] ?? o?.[snake];

function partBlock(p: any): Block {
  const fc = pick(p, "functionCall", "function_call");
  if (fc) return { type: "tool_use", id: fc.id, name: fc.name, input: fc.args ?? {} };
  const fr = pick(p, "functionResponse", "function_response");
  if (fr) return { type: "tool_result", toolUseId: fr.id, name: fr.name, content: [{ type: "raw", data: fr.response }] };
  if (typeof p?.text === "string") return p.thought ? { type: "thinking", text: p.text } : { type: "text", text: p.text };
  const inline = pick(p, "inlineData", "inline_data");
  if (inline) {
    const mime = pick(inline, "mimeType", "mime_type");
    return { type: "image", mediaType: mime, source: `data:${mime};base64,${inline.data}` };
  }
  const file = pick(p, "fileData", "file_data");
  if (file) return { type: "image", mediaType: pick(file, "mimeType", "mime_type"), source: pick(file, "fileUri", "file_uri") };
  const code = pick(p, "executableCode", "executable_code");
  if (code) return { type: "tool_use", name: "code_execution", input: code };
  const result = pick(p, "codeExecutionResult", "code_execution_result");
  if (result) return { type: "tool_result", name: "code_execution", content: [{ type: "text", text: result.output ?? "" }] };
  return { type: "raw", data: p };
}

function parts(content: any): Block[] {
  if (!content) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return (content.parts ?? []).map(partBlock);
}

/** Merge consecutive text/thinking chunks from a stream into single blocks. */
function mergeBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && (b.type === "text" || b.type === "thinking") && last.type === b.type) {
      last.text += b.text;
    } else {
      out.push({ ...b } as Block);
    }
  }
  return out;
}

function usage(u: any): Usage | undefined {
  if (!u) return undefined;
  return {
    input: u.promptTokenCount,
    output: u.candidatesTokenCount,
    cacheRead: u.cachedContentTokenCount,
    reasoning: u.thoughtsTokenCount,
    total: u.totalTokenCount,
  };
}

/** Gemini CLI (cloudcode-pa) wraps the standard body as `{ model, project, request: {...} }`. */
function unwrapRequest(req: any): { body: any; model?: string } {
  if (req?.request?.contents) return { body: req.request, model: req.model };
  return { body: req };
}

export function parseRequest(req: any, url: string): Omit<Normalized, "response"> {
  const { body, model: wrappedModel } = unwrapRequest(req);
  const { contents, systemInstruction, system_instruction, tools, generationConfig, ...params } = body ?? {};
  const model = wrappedModel ?? url.match(/models\/([^:/?]+)/)?.[1];
  const toolDefs: ToolDef[] = [];
  for (const t of tools ?? []) {
    const decls = pick(t, "functionDeclarations", "function_declarations");
    if (decls) {
      for (const d of decls) toolDefs.push({ name: d.name, description: d.description, schema: d.parameters ?? d.parametersJsonSchema });
    } else {
      toolDefs.push({ name: Object.keys(t)[0] ?? "tool", schema: t });
    }
  }
  const messages: Message[] = (contents ?? []).map((c: any) => {
    const blocks = parts(c);
    const role = c.role === "model" ? "assistant" : blocks.length && blocks.every((b) => b.type === "tool_result") ? "tool" : "user";
    return { role, content: blocks };
  });
  return {
    provider: "gemini",
    model,
    stream: url.includes("streamGenerateContent"),
    params: { ...params, ...(generationConfig ? { generationConfig } : {}) },
    system: parts(systemInstruction ?? system_instruction),
    tools: toolDefs,
    messages,
  };
}

function chunks(res: any): any[] {
  const list = Array.isArray(res) ? res : [res];
  return list.map((c) => c?.response ?? c);
}

function fromChunks(list: any[]): NormalizedResponse {
  const out: NormalizedResponse = { blocks: [] };
  const blocks: Block[] = [];
  for (const c of list) {
    if (c?.error) {
      out.error = c.error.message ?? JSON.stringify(c.error);
      continue;
    }
    out.id ??= c.responseId;
    out.model ??= c.modelVersion;
    const cand = c.candidates?.[0];
    if (cand) {
      blocks.push(...parts(cand.content));
      if (cand.finishReason) out.stopReason = cand.finishReason;
    }
    if (c.usageMetadata) out.usage = usage(c.usageMetadata);
  }
  out.blocks = mergeBlocks(blocks);
  return out;
}

export function parseResponseJSON(res: any): NormalizedResponse {
  return fromChunks(chunks(res));
}

export function parseResponseSSE(body: string): NormalizedResponse {
  return fromChunks(sseJSON(body).flatMap((e) => chunks(e.json)));
}
