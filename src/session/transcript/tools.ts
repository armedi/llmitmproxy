/**
 * One-line summaries and categories for tool calls, so a collapsed call reads like
 * "$ bun test" or "src/app.ts (+12 −3)" instead of a JSON blob. Adapted from agentsview.
 */

export type Category = "read" | "edit" | "bash" | "search" | "task" | "web" | "todo" | "mcp" | "other";

type Params = Record<string, unknown>;

const MAX = 160;

const asString = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const params = (input: unknown): Params => (input && typeof input === "object" && !Array.isArray(input) ? (input as Params) : {});
const firstLine = (s: string) => (s.trim().split("\n")[0] ?? "").slice(0, MAX);

function countLines(s: string): number {
  if (!s) return 0;
  const body = s.endsWith("\n") ? s.slice(0, -1) : s;
  return body === "" ? 0 : body.split("\n").length;
}

const fileArg = (p: Params) => asString(p.file_path) ?? asString(p.path) ?? asString(p.filePath) ?? asString(p.file) ?? asString(p.absolute_path);

/** Shell command of a Bash-like call, joined when given as argv. */
export function commandOf(input: unknown): string | undefined {
  const p = params(input);
  const c = p.command ?? p.cmd;
  if (Array.isArray(c)) {
    // Codex sends ["bash", "-lc", "the command"].
    const strs = c.filter((x): x is string => typeof x === "string");
    if (strs.length === 3 && /^(ba|z)?sh$/.test(strs[0]!.split("/").pop()!) && strs[1]!.startsWith("-")) return strs[2];
    return strs.join(" ");
  }
  return asString(c);
}

const lower = (name: string) => name.toLowerCase().replace(/[-\s]/g, "_");

export function category(name: string): Category {
  const n = lower(name);
  if (n.startsWith("mcp__")) return "mcp";
  if (["read", "read_file", "view", "notebookread", "cat", "read_many_files", "open_file"].includes(n)) return "read";
  if (["edit", "multiedit", "write", "write_file", "create_file", "notebookedit", "apply_patch", "str_replace_editor", "replace", "edit_file", "str_replace_based_edit_tool"].includes(n)) return "edit";
  if (["bash", "shell", "exec_command", "run_command", "local_shell", "execute_command", "run_shell_command", "bashoutput", "killshell", "write_stdin"].includes(n)) return "bash";
  if (["grep", "glob", "search", "search_files", "list_files", "ls", "find", "codebase_search", "file_search", "list_directory", "search_file_content", "toolsearch"].includes(n)) return "search";
  if (["task", "agent", "spawn_agent", "subagent", "new_task", "send_input", "wait"].includes(n)) return "task";
  if (["webfetch", "websearch", "web_fetch", "web_search", "google_web_search", "fetch"].includes(n)) return "web";
  if (["todowrite", "update_plan", "todo_write", "todoread", "write_todos"].includes(n)) return "todo";
  return "other";
}

/** Lines added and removed by an edit-like call, when its input says. */
function editStats(name: string, input: unknown): { added: number; removed: number } | undefined {
  const p = params(input);
  const n = lower(name);
  if (n === "write" || n === "write_file" || n === "create_file") {
    const content = asString(p.content) ?? asString(p.contents) ?? asString(p.file_text);
    return content != null ? { added: countLines(content), removed: 0 } : undefined;
  }
  const edits = Array.isArray(p.edits) ? (p.edits as Params[]) : asString(p.old_string) != null || asString(p.new_string) != null ? [p] : [];
  if (edits.length) {
    let added = 0;
    let removed = 0;
    for (const e of edits) {
      added += countLines(asString(e.new_string) ?? "");
      removed += countLines(asString(e.old_string) ?? "");
    }
    return { added, removed };
  }
  const patch = patchText(input);
  if (patch) {
    let added = 0;
    let removed = 0;
    for (const l of patch.split("\n")) {
      if (l.startsWith("+") && !l.startsWith("+++")) added++;
      else if (l.startsWith("-") && !l.startsWith("---")) removed++;
    }
    return { added, removed };
  }
  return undefined;
}

/** Patch text from an apply_patch-style call (a string input, or `input`/`patch`). */
export function patchText(input: unknown): string | undefined {
  const s = typeof input === "string" ? input : (asString(params(input).input) ?? asString(params(input).patch));
  return s && /^\*\*\* Begin Patch|^(---|\+\+\+|@@) /m.test(s) ? s : undefined;
}

/** Files touched by an apply_patch patch. */
function patchFiles(patch: string): string[] {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1]!.trim());
}

function todoSummary(p: Params): string | undefined {
  const todos = (Array.isArray(p.todos) ? p.todos : Array.isArray(p.plan) ? p.plan : undefined) as Params[] | undefined;
  if (!todos?.length) return undefined;
  const active = todos.find((t) => t.status === "in_progress");
  const done = todos.filter((t) => t.status === "completed").length;
  const label = asString(active?.content) ?? asString(active?.step) ?? asString(active?.activeForm);
  return `${done}/${todos.length} done${label ? ` → ${label}` : ""}`;
}

/** Short relative-looking path: the last three segments. */
function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}

/** One-line description of a tool call for its collapsed header. */
export function summarize(name: string, input: unknown): string {
  const p = params(input);
  const cat = category(name);
  const cmd = commandOf(input);
  if (cmd && (cat === "bash" || cat === "other")) return `$ ${firstLine(cmd)}`;
  const n = lower(name);
  if (cat === "todo") return todoSummary(p) ?? "";
  if (cat === "task") return firstLine(asString(p.description) ?? asString(p.prompt) ?? asString(p.message) ?? "");
  const patch = patchText(input);
  if (patch) {
    const files = patchFiles(patch);
    const s = editStats(name, input)!;
    const where = files.length > 1 ? `${files.length} files` : files[0] ? shortPath(files[0]) : "patch";
    return `${where} (+${s.added} −${s.removed})`;
  }
  const file = fileArg(p);
  if (cat === "edit" && file) {
    const s = editStats(name, input);
    return s ? `${shortPath(file)} (+${s.added}${s.removed ? ` −${s.removed}` : ""})` : shortPath(file);
  }
  if (cat === "read" && file) {
    const range = typeof p.offset === "number" ? ` :${p.offset}${typeof p.limit === "number" ? `+${p.limit}` : ""}` : "";
    return `${shortPath(file)}${range}`;
  }
  if (n === "grep" || n === "search_file_content") {
    const where = asString(p.path) ?? asString(p.glob);
    return `${asString(p.pattern) ?? ""}${where ? `  in ${shortPath(where)}` : ""}`;
  }
  const q = asString(p.pattern) ?? asString(p.query) ?? asString(p.url) ?? asString(p.q);
  if (q) return firstLine(q);
  if (file) return shortPath(file);
  // Fall back to a description or the first string argument.
  const s = asString(p.description) ?? Object.values(p).find((v): v is string => typeof v === "string");
  if (s) return firstLine(s);
  return typeof input === "string" ? firstLine(input) : "";
}

/** One-line hint about a result: its size, or its first line. */
export function resultHint(text: string): string {
  const lines = countLines(text);
  if (lines > 1) return `${lines} lines`;
  return firstLine(text);
}
