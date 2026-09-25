import type { Block, Message, Normalized } from "../../llm/types";

export type ToolResult = Extract<Block, { type: "tool_result" }>;

export interface MessageItem {
  kind: "message";
  /** Position in the thread; the response is `messages.length`. */
  index: number;
  role: Message["role"];
  blocks: Block[];
  response?: boolean;
}

/** Consecutive assistant messages that only call tools. */
export interface ToolGroupItem {
  kind: "tools";
  index: number;
  items: MessageItem[];
  calls: number;
}

export type Item = MessageItem | ToolGroupItem;

/** tool_use id → its result, from any later message. */
function pairResults(messages: Message[]): Map<string, ToolResult> {
  const out = new Map<string, ToolResult>();
  for (const m of messages) for (const b of m.content) if (b.type === "tool_result" && b.toolUseId && !out.has(b.toolUseId)) out.set(b.toolUseId, b);
  return out;
}

const hasText = (blocks: Block[]) => blocks.some((b) => b.type === "text" && b.text.trim());
const isToolOnly = (m: MessageItem) => m.role === "assistant" && m.blocks.some((b) => b.type === "tool_use") && !hasText(m.blocks);

/**
 * Turn a thread into display items: tool results move under their calls (a message left with
 * nothing else disappears) and runs of tool-only assistant messages collapse into one group.
 */
export function buildItems(n: Normalized, pending = false): { items: Item[]; results: Map<string, ToolResult> } {
  const calls = new Set<string>();
  for (const m of n.messages) for (const b of m.content) if (b.type === "tool_use" && b.id) calls.add(b.id);
  if (n.response) for (const b of n.response.blocks) if (b.type === "tool_use" && b.id) calls.add(b.id);
  const results = new Map([...pairResults(n.messages)].filter(([id]) => calls.has(id)));

  const flat: MessageItem[] = [];
  n.messages.forEach((m, index) => {
    const blocks = m.content.filter((b) => !(b.type === "tool_result" && b.toolUseId && results.has(b.toolUseId)));
    if (!blocks.length) {
      if (m.content.length) return; // only paired results: shown under their calls
      flat.push({ kind: "message", index, role: m.role, blocks });
      return;
    }
    const role = blocks.every((b) => b.type === "tool_result") ? "tool" : m.role;
    flat.push({ kind: "message", index, role, blocks });
  });
  if (n.response || pending) flat.push({ kind: "message", index: n.messages.length, role: "assistant", blocks: n.response?.blocks ?? [], response: true });

  const items: Item[] = [];
  let run: MessageItem[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const calls = run.reduce((a, m) => a + m.blocks.filter((b) => b.type === "tool_use").length, 0);
      items.push({ kind: "tools", index: run[0]!.index, items: run, calls });
    } else items.push(...run);
    run = [];
  };
  for (const it of flat) {
    // The live response stays outside groups so it is always visible.
    if (isToolOnly(it) && !it.response) run.push(it);
    else {
      flush();
      items.push(it);
    }
  }
  flush();
  return { items, results };
}

/** Only the user's prompts and the final answer of each turn. */
export function focusItems(items: Item[]): Item[] {
  const out: Item[] = [];
  let answer: MessageItem | undefined;
  for (const it of items) {
    if (it.kind !== "message") continue;
    if (it.role === "user" && hasText(it.blocks)) {
      if (answer) out.push(answer);
      answer = undefined;
      out.push(it);
    } else if (it.role === "assistant" && (hasText(it.blocks) || it.response)) answer = it;
  }
  if (answer) out.push(answer);
  return out;
}

/** Everything searchable in an item, lowercased, including collapsed tool input/output and thinking. */
export function itemText(it: Item, results: Map<string, ToolResult>): string {
  const parts: string[] = [];
  const visit = (b: Block) => {
    switch (b.type) {
      case "text":
      case "thinking":
        parts.push(b.text);
        break;
      case "tool_use": {
        parts.push(b.name, typeof b.input === "string" ? b.input : JSON.stringify(b.input));
        const r = b.id ? results.get(b.id) : undefined;
        if (r) r.content.forEach(visit);
        break;
      }
      case "tool_result":
        b.content.forEach(visit);
        break;
      case "raw":
        parts.push(typeof b.data === "string" ? b.data : JSON.stringify(b.data));
        break;
    }
  };
  const walk = (i: Item) => {
    if (i.kind === "message") i.blocks.forEach(visit);
    else i.items.forEach(walk);
  };
  walk(it);
  return parts.join("\n").toLowerCase();
}

/** Plain text of a result's content. */
export const resultText = (r: ToolResult) => r.content.map((c) => (c.type === "text" ? c.text : c.type === "raw" ? JSON.stringify(c.data) : "")).join("\n");
