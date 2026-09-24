import type { Block, Message, Normalized } from "../../server/types";

export type ToolResult = Extract<Block, { type: "tool_result" }>;

/** Tags agents wrap injected context in. A text block made only of these is a boundary, not a prompt. */
const TAG_BLOCK = /<([a-z][a-z0-9_-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
const TAG_LABELS: Record<string, string> = {
  "system-reminder": "System reminder",
  "command-name": "Slash command",
  "command-message": "Slash command",
  "command-args": "Slash command",
  "local-command-stdout": "Command output",
  "local-command-stderr": "Command output",
  "local-command-caveat": "Command caveat",
  "task-notification": "Task notification",
  "user-prompt-submit-hook": "Prompt hook",
  "bash-input": "Shell input",
  "bash-stdout": "Shell output",
  "bash-stderr": "Shell output",
  environment_context: "Environment context",
  user_instructions: "User instructions",
  "user-memory-input": "Memory",
};

export interface Boundary {
  tag: string;
  label: string;
  body: string;
}

/** The injected-context tags a text block consists of, if it is nothing but those. */
export function boundaryOf(text: string): Boundary | undefined {
  const tags = [...text.matchAll(TAG_BLOCK)];
  if (!tags.length || text.replace(TAG_BLOCK, "").trim()) return undefined;
  const tag = tags[0]![1]!.toLowerCase();
  const body = tags.map((m) => m[2]!.trim()).filter(Boolean).join("\n");
  return { tag, label: TAG_LABELS[tag] ?? tag, body };
}

export interface MessageItem {
  kind: "message";
  /** Position in the thread; the response is `messages.length`. */
  index: number;
  role: Message["role"];
  blocks: Block[];
  response?: boolean;
}

export interface BoundaryItem {
  kind: "boundary";
  index: number;
  boundaries: Boundary[];
}

/** Consecutive assistant messages that only call tools, with any reminders injected between them. */
export interface ToolGroupItem {
  kind: "tools";
  index: number;
  items: (MessageItem | BoundaryItem)[];
  calls: number;
}

export type Item = MessageItem | BoundaryItem | ToolGroupItem;

/** tool_use id → its result, from any later message. */
export function pairResults(messages: Message[]): Map<string, ToolResult> {
  const out = new Map<string, ToolResult>();
  for (const m of messages) for (const b of m.content) if (b.type === "tool_result" && b.toolUseId && !out.has(b.toolUseId)) out.set(b.toolUseId, b);
  return out;
}

const hasText = (blocks: Block[]) => blocks.some((b) => b.type === "text" && b.text.trim() && !boundaryOf(b.text));
const isToolOnly = (m: MessageItem) => m.role === "assistant" && m.blocks.some((b) => b.type === "tool_use") && !hasText(m.blocks);

/**
 * Turn a thread into display items: tool results move under their calls (a message left with
 * nothing else disappears), reminder-only messages become boundaries, and runs of tool-only
 * assistant messages collapse into one group.
 */
export function buildItems(n: Normalized, pending = false): { items: Item[]; results: Map<string, ToolResult> } {
  const calls = new Set<string>();
  for (const m of n.messages) for (const b of m.content) if (b.type === "tool_use" && b.id) calls.add(b.id);
  if (n.response) for (const b of n.response.blocks) if (b.type === "tool_use" && b.id) calls.add(b.id);
  const results = new Map([...pairResults(n.messages)].filter(([id]) => calls.has(id)));

  const flat: (MessageItem | BoundaryItem)[] = [];
  n.messages.forEach((m, index) => {
    const blocks = m.content.filter((b) => !(b.type === "tool_result" && b.toolUseId && results.has(b.toolUseId)));
    if (!blocks.length) {
      if (m.content.length) return; // only paired results: shown under their calls
      flat.push({ kind: "message", index, role: m.role, blocks });
      return;
    }
    const role = blocks.every((b) => b.type === "tool_result") ? "tool" : m.role;
    const bounds = blocks.map((b) => (b.type === "text" ? boundaryOf(b.text) : undefined));
    if (m.role === "user" && bounds.every((b) => b)) flat.push({ kind: "boundary", index, boundaries: bounds as Boundary[] });
    else flat.push({ kind: "message", index, role, blocks });
  });
  if (n.response || pending) flat.push({ kind: "message", index: n.messages.length, role: "assistant", blocks: n.response?.blocks ?? [], response: true });

  const items: Item[] = [];
  let run: (MessageItem | BoundaryItem)[] = [];
  const flush = () => {
    // Trailing boundaries aren't part of the group.
    const tail: BoundaryItem[] = [];
    while (run.length && run[run.length - 1]!.kind === "boundary") tail.unshift(run.pop() as BoundaryItem);
    const tools = run.filter((i): i is MessageItem => i.kind === "message");
    if (tools.length >= 2) {
      const calls = tools.reduce((a, m) => a + m.blocks.filter((b) => b.type === "tool_use").length, 0);
      items.push({ kind: "tools", index: run[0]!.index, items: run, calls });
    } else items.push(...run);
    items.push(...tail);
    run = [];
  };
  for (const it of flat) {
    // The live response stays outside groups so it is always visible.
    if (it.kind === "message" && isToolOnly(it) && !it.response) run.push(it);
    else if (it.kind === "boundary" && run.length) run.push(it);
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
    else if (i.kind === "boundary") i.boundaries.forEach((b) => parts.push(b.body));
    else i.items.forEach(walk);
  };
  walk(it);
  return parts.join("\n").toLowerCase();
}

/** Plain text of a result's content. */
export const resultText = (r: ToolResult) => r.content.map((c) => (c.type === "text" ? c.text : c.type === "raw" ? JSON.stringify(c.data) : "")).join("\n");
