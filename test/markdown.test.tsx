import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ForceOpen, Text } from "../src/session/Blocks";
import { clampMarkdown, Formatted, Markdown } from "../src/components/Markdown";

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  test("renders GFM", () => {
    const html = render("**bold** `code`\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
  });

  test("shows XML-like tags as text instead of HTML", () => {
    const html = render("<system-reminder>\nline one\nline two\n</system-reminder>\n\nhi <b>x</b> <img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;system-reminder&gt;\nline one\nline two\n&lt;/system-reminder&gt;");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<system-reminder>");
    expect(html).not.toContain("<b>");
    expect(html).not.toMatch(/<img/);
  });

  test("does not load markdown images or allow javascript: links", () => {
    const html = render("![pic](http://example.com/a.png) [x](javascript:alert(1))");
    expect(html).not.toMatch(/<img/);
    expect(html).toContain("[image: pic]");
    expect(html).not.toContain("javascript:");
  });
});

describe("clampMarkdown", () => {
  test("leaves short text alone", () => {
    expect(clampMarkdown("abc", 10)).toBe("abc");
  });

  test("cuts at a paragraph boundary", () => {
    const text = "a".repeat(60) + "\n\n" + "b".repeat(60) + "\n\n" + "c".repeat(60);
    expect(clampMarkdown(text, 130)).toBe("a".repeat(60) + "\n\n" + "b".repeat(60) + "\n\n…");
  });

  test("closes a code fence it cuts through", () => {
    const text = "intro\n\n```ts\n" + Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") + "\n```\nafter";
    const out = clampMarkdown(text, 200);
    expect(out.length).toBeLessThan(220);
    expect(out.endsWith("\n…\n```")).toBe(true);
  });

  test("ignores blank lines inside fences", () => {
    const text = "x".repeat(20) + "\n\n```\n" + "y".repeat(40) + "\n\n" + "z".repeat(40) + "\n```\n" + "w".repeat(100);
    // The blank line inside the fence (at ~62) is not a valid cut; the closed fence at 111 is.
    const out = clampMarkdown(text, 120);
    expect(out).toContain("z".repeat(40) + "\n```");
    expect(out.match(/```/g)!.length % 2).toBe(0);
  });
});

describe("Text", () => {
  const text = (t: string, { markdown = true, formatted = true, force = false, fold = true } = {}) =>
    renderToStaticMarkup(
      <Formatted.Provider value={formatted}>
        <ForceOpen.Provider value={force}>
          <Text text={t} markdown={markdown} fold={fold} />
        </ForceOpen.Provider>
      </Formatted.Provider>,
    );
  const sample = "Hi **there**\n<system-reminder>\nsecret *note*\nmore\n</system-reminder>";

  test("folds XML sections, collapsed", () => {
    const html = text(sample);
    expect(html).toContain("<strong>there</strong>");
    expect(html).toContain('<details class="xml">');
    expect(html).toContain("&lt;system-reminder&gt;");
    expect(html).toContain('<span class="x-preview">secret *note*</span>');
    expect(html).not.toContain("<em>note</em>");
  });

  test("renders section bodies when forced open", () => {
    expect(text(sample, { force: true })).toContain("<em>note</em>");
  });

  test("renders each tag as one text node", () => {
    const html = text('<file path="a.ts">\nx\ny\n</file>', { force: true });
    expect(html).toContain('<span class="x-tag">&lt;file path=&quot;a.ts&quot;&gt;</span>');
    expect(html).toContain('aria-label="Collapse &lt;file&gt;"');
  });

  test("short one-line sections render inline, not folded", () => {
    const html = text("<command-name>/clear</command-name>\n<command-args></command-args>");
    expect(html).toContain('<div class="xml xml-inline"><span class="x-tag">&lt;command-name&gt;</span><span class="x-value">/clear</span></div>');
    expect(html).toContain('<div class="xml xml-inline"><span class="x-tag">&lt;command-args&gt;</span></div>');
    expect(html).not.toContain("<details");
  });

  test("tool output folds every tag, as plain text", () => {
    const out = "<html>\n<body>\n</body>\n</html>\n<system-reminder>\nx\ny\n</system-reminder>";
    const html = text(out, { markdown: false, force: true });
    expect(html).toContain('<span class="x-tag">&lt;html&gt;</span>');
    expect(html).toContain('<span class="x-tag">&lt;system-reminder&gt;</span>');
    expect(html).toContain("<pre>x\ny</pre>");
  });

  test("tool args don't fold", () => {
    expect(text("<div>\nx\n</div>", { markdown: false, fold: false })).toBe('<div class="text"><pre>&lt;div&gt;\nx\n&lt;/div&gt;</pre></div>');
  });

  test("link definitions reach prose on the other side of a section", () => {
    const html = text("See [docs][1]\n<example>\nx\n</example>\n[1]: https://x.com");
    expect(html).toContain('<a href="https://x.com" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  test("plain mode shows the raw text", () => {
    const html = text(sample, { formatted: false });
    expect(html).not.toContain("<details");
    expect(html).toContain("<pre>Hi **there**\n&lt;system-reminder&gt;");
  });

  test("collapsed sections don't count toward the clamp", () => {
    const html = text(`short\n<big>\n${"x".repeat(5000)}\n</big>`);
    expect(html).not.toContain("Show all");
    expect(text("y".repeat(5000))).toContain("Show all (5,000 chars)");
    const many = Array.from({ length: 25 }, (_, i) => `<f>\n${"z".repeat(100)}${i}\n</f>`).join("\n");
    expect(text(many)).toContain("Show all (0 chars, 25 sections)");
  });
});
