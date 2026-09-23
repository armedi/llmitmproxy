import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { clampMarkdown, Markdown } from "../web/components/Markdown";

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
