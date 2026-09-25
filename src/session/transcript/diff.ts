import { patchText } from "./tools";

export type DiffLine = { kind: "add" | "del" | "ctx" | "hunk" | "file"; text: string };

type Params = Record<string, unknown>;

const lines = (s: string) => (s === "" ? [] : (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n"));

/** Diff of one replacement: shared leading/trailing lines stay as context. */
export function replacementDiff(oldText: string, newText: string): DiffLine[] {
  const a = lines(oldText);
  const b = lines(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let post = 0;
  while (post < a.length - pre && post < b.length - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
  const out: DiffLine[] = [{ kind: "hunk", text: `@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@` }];
  for (const t of a.slice(0, pre)) out.push({ kind: "ctx", text: t });
  for (const t of a.slice(pre, a.length - post)) out.push({ kind: "del", text: t });
  for (const t of b.slice(pre, b.length - post)) out.push({ kind: "add", text: t });
  for (const t of a.slice(a.length - post)) out.push({ kind: "ctx", text: t });
  return out;
}

/** Lines of a unified diff or an apply_patch patch, classified for coloring. */
export function patchLines(patch: string): DiffLine[] {
  return lines(patch).map((text) => {
    if (/^(\*\*\* |diff --git|index |--- |\+\+\+ )/.test(text)) return { kind: "file", text };
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (text.startsWith("+")) return { kind: "add", text: text.slice(1) };
    if (text.startsWith("-")) return { kind: "del", text: text.slice(1) };
    return { kind: "ctx", text: text.startsWith(" ") ? text.slice(1) : text };
  });
}

/** A diff view of an edit-like tool call's input, or undefined when it isn't one. */
export function toolDiff(name: string, input: unknown): DiffLine[] | undefined {
  const p = (input && typeof input === "object" ? input : {}) as Params;
  const n = name.toLowerCase();
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (n === "write" || n === "write_file" || n === "create_file") {
    const content = str(p.content) ?? str(p.contents) ?? str(p.file_text);
    if (content == null) return undefined;
    return [{ kind: "hunk", text: `@@ new file, ${lines(content).length} lines @@` }, ...lines(content).map((text) => ({ kind: "add" as const, text }))];
  }
  if (Array.isArray(p.edits)) {
    return (p.edits as Params[]).flatMap((e) => replacementDiff(str(e.old_string) ?? "", str(e.new_string) ?? ""));
  }
  if (str(p.old_string) != null || str(p.new_string) != null) return replacementDiff(str(p.old_string) ?? "", str(p.new_string) ?? "");
  const patch = patchText(input);
  return patch ? patchLines(patch) : undefined;
}
