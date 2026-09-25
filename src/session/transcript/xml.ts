import { nextFence } from "./fence";

export interface XmlElement {
  tag: string;
  /** Raw attribute text after the tag name, e.g. ` name="x"`; empty if none. */
  attrs: string;
  children: XmlNode[];
}

export type XmlNode = string | XmlElement;

type Token =
  | { kind: "text"; value: string }
  /** `indent`: the indentation of the line the tag is on. */
  | { kind: "open"; tag: string; attrs: string; raw: string; indent: number }
  | { kind: "close"; tag: string; raw: string };
const OPEN = /^(\s*)<([A-Za-z][\w.:-]*)((?:\s[^<>]*)?)>/;
const CLOSE = /<\/([A-Za-z][\w.:-]*)\s*>(\s*)$/;

/**
 * Split text into prose and the XML-like elements prompts are full of (<system-reminder>, …).
 * Only block-level tags count: an open tag must start a line and its close tag end one, so inline
 * uses (`press <kbd>x</kbd>`, `Vec<T>`) stay text. An indented tag outside any element belongs to a
 * markdown list item or code block, so it stays text too, unless it's on the line right after one closed. Tags inside code fences are ignored, and
 * a tag without a matching partner is left as literal text.
 */
export function parseXml(text: string): XmlNode[] {
  if (!text.includes("<")) return [text];
  const tokens = tokenize(text);
  if (!tokens.some((t) => t.kind !== "text")) return [text];

  const stack: { open?: Extract<Token, { kind: "open" }>; children: XmlNode[] }[] = [{ children: [] }];
  const top = () => stack[stack.length - 1]!;
  // An open tag that never closed: put its raw text back in the parent.
  const revert = () => {
    const f = stack.pop()!;
    top().children.push(f.open!.raw, ...f.children);
  };
  // Whether a top-level element closed at the end of the previous line: tags indented under it
  // continue the run (Claude Code indents <command-message> under <command-name>).
  let afterClose = false;
  for (const t of tokens) {
    if (t.kind === "text") {
      top().children.push(t.value);
      afterClose &&= t.value === "\n";
    } else if (t.kind === "open") {
      if (stack.length === 1 && t.indent > 0 && !afterClose) top().children.push(t.raw);
      else stack.push({ open: t, children: [] });
      afterClose = false;
    }
    else {
      let i = stack.length - 1;
      while (i > 0 && stack[i]!.open!.tag !== t.tag) i--;
      if (i === 0) {
        top().children.push(t.raw);
        continue;
      }
      while (stack.length - 1 > i) revert();
      const f = stack.pop()!;
      top().children.push({ tag: t.tag, attrs: f.open!.attrs, children: clean(f.children, true) });
      afterClose = stack.length === 1;
    }
  }
  while (stack.length > 1) revert();
  const root = stack[0]!.children;
  return root.some((n) => typeof n !== "string") ? clean(root, false) : [text];
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const push = (value: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === "text") last.value += value;
    else if (value) tokens.push({ kind: "text", value });
  };
  let fence: string | null = null;
  // Indentation of the open tags around the current line, so a fence is judged relative to its element.
  const indents: number[] = [];
  const lines = text.split("\n");
  lines.forEach((line, n) => {
    const nl = n < lines.length - 1 ? "\n" : "";
    const indent = /^[ \t]*/.exec(line)![0].length;
    const next = nextFence(fence, line.slice(Math.min(indent, indents[indents.length - 1] ?? 0)));
    if (fence != null || next != null) {
      fence = next;
      push(line + nl);
      return;
    }

    const opens: Token[] = [];
    let rest = line;
    for (let m = OPEN.exec(rest); m && !m[3]!.trimEnd().endsWith("/"); m = OPEN.exec(rest)) {
      opens.push({ kind: "open", tag: m[2]!, attrs: m[3]!, raw: m[0], indent });
      indents.push(indent);
      rest = rest.slice(m[0].length);
    }
    const closes: Token[] = [];
    for (let m = CLOSE.exec(rest); m; m = CLOSE.exec(rest)) {
      closes.unshift({ kind: "close", tag: m[1]!, raw: m[0] });
      indents.pop();
      rest = rest.slice(0, m.index);
    }
    if (!opens.length && !closes.length) {
      push(line + nl);
      return;
    }
    // A line of nothing but tags vanishes, newline included (kept in the raw text in case a tag reverts).
    const tagsOnly = !rest.trim();
    const all = [...opens, ...closes];
    if (tagsOnly) {
      const last = all[all.length - 1] as { raw: string };
      last.raw += rest + nl;
    }
    for (const t of opens) tokens.push(t);
    if (!tagsOnly) push(rest);
    for (const t of closes) tokens.push(t);
    if (!tagsOnly) push(nl);
  });
  return tokens;
}

/** Merge adjacent strings, drop blank ones, trim edge blank lines; element bodies are also dedented. */
function clean(nodes: XmlNode[], body: boolean): XmlNode[] {
  const merged: XmlNode[] = [];
  for (const n of nodes) {
    const last = merged[merged.length - 1];
    if (typeof n === "string" && typeof last === "string") merged[merged.length - 1] = last + n;
    else merged.push(n);
  }
  const out: XmlNode[] = [];
  for (const n of merged) {
    if (typeof n !== "string") out.push(n);
    else {
      const s = (body ? dedent(n) : n).replace(/^(?:[ \t]*\n)+/, "").trimEnd();
      if (s.trim()) out.push(s);
    }
  }
  return out;
}

function dedent(s: string): string {
  const lines = s.split("\n");
  let min = Infinity;
  for (const l of lines) if (l.trim()) min = Math.min(min, /^[ \t]*/.exec(l)![0].length);
  return min === 0 || min === Infinity ? s : lines.map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)![0].length))).join("\n");
}
