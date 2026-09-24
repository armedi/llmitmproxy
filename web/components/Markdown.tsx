import { createContext, memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { Element, Root as HastRoot } from "hast";
import type { Html, Root } from "mdast";

const HIGHLIGHT_LIMIT = 50_000;

// Highlighting huge blocks freezes the page; mark them plain before rehype-highlight runs.
function rehypeSkipHuge() {
  return (tree: HastRoot) => {
    const visit = (node: HastRoot | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "code") {
          const len = child.children.reduce((a, c) => a + (c.type === "text" ? c.value.length : 0), 0);
          if (len > HIGHLIGHT_LIMIT) child.properties.className = ["no-highlight"];
        } else visit(child);
      }
    };
    visit(tree);
  };
}

// Prompts are full of XML-like tags (<system-reminder>, <command-name>, …). Never interpret
// them as HTML: turn every raw-HTML node into literal text, keeping its line breaks.
function remarkLiteralHtml() {
  return (tree: Root) => {
    const visit = (node: { type: string; children?: unknown[] }, inline: boolean) => {
      node.children?.forEach((child) => {
        const c = child as { type: string; children?: unknown[] };
        if (c.type === "html") {
          const h = c as Html;
          const replacement = {
            type: "paragraph",
            data: { hName: inline ? "span" : "div", hProperties: { className: "md-literal" } },
            children: [{ type: "text", value: h.value }],
          };
          Object.assign(c, replacement);
          delete (c as Partial<Html>).value;
        } else {
          visit(c, inline || c.type === "paragraph" || c.type === "heading" || c.type === "tableCell");
        }
      });
    };
    visit(tree, false);
  };
}

/** Global "Markdown / Plain" switch. Only message prose honors it; tool args/results are always plain. */
export const MarkdownMode = createContext(true);

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Don't let captured content load remote images; link to them instead.
  img: ({ src, alt }) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">
      [image{alt ? `: ${alt}` : ""}]
    </a>
  ),
};

const remarkPlugins = [remarkGfm, remarkLiteralHtml];
const rehypePlugins = [rehypeSkipHuge, rehypeHighlight];

/** Renders untrusted text as GFM markdown. Raw HTML is shown as text, never executed. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Cut markdown to roughly `limit` chars without leaving a code fence open: prefer a blank line
 * outside any fence, otherwise cut at a line boundary and close the open fence.
 */
export function clampMarkdown(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let fence: string | null = null;
  let pos = 0;
  let lastBreak = -1; // end of a blank-line boundary outside any fence
  let lastLine = 0;
  let fenceAtLastLine: string | null = null;
  for (const line of text.split("\n")) {
    const end = pos + line.length;
    if (end > limit) break;
    const m = FENCE.exec(line);
    if (m) {
      const marker = m[1]!;
      if (fence == null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    }
    if (fence == null && line.trim() === "") lastBreak = pos;
    lastLine = end;
    fenceAtLastLine = fence;
    pos = end + 1;
  }
  if (lastBreak >= limit / 2) return text.slice(0, lastBreak).trimEnd() + "\n\n…";
  if (lastLine === 0) return text.slice(0, limit) + "…"; // one huge first line
  const cut = text.slice(0, lastLine);
  return fenceAtLastLine ? `${cut}\n…\n${fenceAtLastLine}` : `${cut}\n\n…`;
}
