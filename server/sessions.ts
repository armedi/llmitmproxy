import type { Block, Message, Normalized } from "./types";

const hash = (s: string) => Bun.hash(s).toString(36);

/**
 * Reduce a block to the parts that stay stable when a client resends history.
 * Clients move cache_control markers, drop old thinking blocks and re-serialize tool
 * input, so only the text and the tool call identity are compared.
 */
function canonicalBlock(b: Block): unknown {
  switch (b.type) {
    case "text":
      return ["t", b.text.trim()];
    case "thinking":
      return null;
    case "tool_use":
      return ["u", b.id ?? b.name];
    case "tool_result":
      return ["r", b.toolUseId ?? b.name, b.content.map(canonicalBlock)];
    case "image":
      return ["i", b.source ? hash(b.source) : ""];
    case "raw":
      return ["x", stripVolatile(b.data)];
  }
}

function stripVolatile(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (k !== "cache_control") out[k] = stripVolatile(val);
    return out;
  }
  return v;
}

export function messageHashes(messages: Message[]): string[] {
  return messages.map((m) => {
    const role = m.role === "tool" ? "user" : m.role;
    const blocks = m.content.map(canonicalBlock).filter((x) => x !== null);
    return hash(role + JSON.stringify(blocks));
  });
}

/**
 * Identifies "the same agent" so unrelated conversations never chain together.
 * The system prompt is left out on purpose: clients embed volatile data there
 * (Claude Code's billing header, dates, git status), which would split sessions.
 */
export function fingerprint(n: Normalized): string {
  const tools = n.tools.map((t) => t.name).sort().join(",");
  return hash(`${n.provider}|${tools}`);
}

export interface Candidate {
  sessionId: number;
  hashes: string[];
}

/**
 * Pick the session this request continues. A session matches when its latest request's
 * messages are a prefix of the new request's messages. If the client rewrote the last
 * message (common with injected reminders), it still matches, but with a lower score.
 * Candidates must be ordered most-recent first; ties keep the most recent.
 */
export function matchSession(candidates: Candidate[], hashes: string[]): number | undefined {
  let best: { id: number; score: number } | undefined;
  for (const c of candidates) {
    const score = prefixScore(c.hashes, hashes);
    if (score > 0 && (!best || score > best.score)) best = { id: c.sessionId, score };
  }
  return best?.id;
}

function prefixScore(prev: string[], next: string[]): number {
  if (!prev.length || prev.length > next.length) return 0;
  let i = 0;
  while (i < prev.length && prev[i] === next[i]) i++;
  if (i === prev.length) return prev.length;
  if (prev.length >= 3 && i === prev.length - 1) return prev.length - 1.5;
  return 0;
}

const TAG_ONLY = /^\s*<([a-z0-9_-]+)[^>]*>[\s\S]*<\/\1>\s*$/i;

export function titleFor(n: Normalized): string {
  const texts = n.messages
    .filter((m) => m.role === "user")
    .flatMap((m) => m.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text));
  // Codex sends injected context (<environment_context>) as its own user message before the prompt.
  const real = texts.find((t) => t.trim() && !TAG_ONLY.test(t)) ?? texts.find((t) => t.trim());
  if (real) {
    const clean = real.replace(/<([a-z0-9_-]+)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/\s+/g, " ").trim() || real.trim();
    return clean.slice(0, 120);
  }
  return n.model ? `(${n.model})` : "(untitled)";
}
