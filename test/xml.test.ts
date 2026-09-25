import { describe, expect, test } from "vitest";
import { parseXml, type XmlElement, type XmlNode } from "../src/session/transcript/xml";

const el = (tag: string, children: XmlNode[], attrs = ""): XmlElement => ({ tag, attrs, children });

describe("parseXml", () => {
  test("leaves text without tags untouched", () => {
    const text = "  hello\n\n    code\n";
    expect(parseXml(text)).toEqual([text]);
  });

  test("folds an element without blank lines", () => {
    expect(parseXml("<system-reminder>\nfoo **bold**\n</system-reminder>")).toEqual([el("system-reminder", ["foo **bold**"])]);
  });

  test("folds an element with blank lines inside", () => {
    expect(parseXml("<system-reminder>\n\nfoo\n\nbar\n\n</system-reminder>")).toEqual([el("system-reminder", ["foo\n\nbar"])]);
  });

  test("accepts underscores, dots and colons in tag names", () => {
    expect(parseXml("<tool_call>\nx\n</tool_call>\n<xs:el>\ny\n</xs:el>\n<a.b>\nz\n</a.b>")).toEqual([
      el("tool_call", ["x"]),
      el("xs:el", ["y"]),
      el("a.b", ["z"]),
    ]);
  });

  test("splits prose around elements", () => {
    expect(parseXml("Some text\n<env>\nfoo\n</env>\nafter")).toEqual(["Some text", el("env", ["foo"]), "after"]);
  });

  test("folds one-line elements", () => {
    expect(parseXml("<command-name>/model</command-name>\n<command-args></command-args>")).toEqual([
      el("command-name", ["/model"]),
      el("command-args", []),
    ]);
  });

  test("handles content on the tag lines", () => {
    expect(parseXml("<note>first\nsecond</note>")).toEqual([el("note", ["first\nsecond"])]);
  });

  test("dedents element bodies", () => {
    expect(parseXml("<env>\n    cwd: /foo\n      nested\n</env>")).toEqual([el("env", ["cwd: /foo\n  nested"])]);
  });

  test("nests", () => {
    expect(parseXml("<a>\n  intro\n  <b>\n    x\n  </b>\n</a>")).toEqual([el("a", ["intro", el("b", ["x"])])]);
    expect(parseXml("<a><b>x</b></a>")).toEqual([el("a", [el("b", ["x"])])]);
  });

  test("captures attributes", () => {
    expect(parseXml('<file path="a.ts" lang=ts>\nx\n</file>')).toEqual([el("file", ["x"], ' path="a.ts" lang=ts')]);
  });

  test("ignores tags inside code fences", () => {
    const fenced = "```html\n<div>\nx\n</div>\n```";
    expect(parseXml(fenced)).toEqual([fenced]);
    expect(parseXml("<doc>\n~~~\n<div>\n</div>\n~~~\n</doc>")).toEqual([el("doc", ["~~~\n<div>\n</div>\n~~~"])]);
  });

  test("only a fence indented less than four spaces counts", () => {
    expect(parseXml("    ```\n<env>\nx\n</env>")).toEqual(["    ```", el("env", ["x"])]);
    // Inside an element the indentation is judged from the element's own.
    expect(parseXml("<doc>\n  <inner>\n    ```\n    <div>\n    </div>\n    ```\n  </inner>\n</doc>")).toEqual([
      el("doc", [el("inner", ["```\n<div>\n</div>\n```"])]),
    ]);
  });

  test("keeps indented top-level tags as text, so markdown lists stay whole", () => {
    const text = "- a\n  <note>\n  x\n  </note>\n- b";
    expect(parseXml(text)).toEqual([text]);
    const code = "return (\n    <div>\n      <p>hi</p>\n      <p>yo</p>\n    </div>\n  );";
    expect(parseXml(code)).toEqual([code]);
  });

  test("an indented tag right after a closed one continues the run", () => {
    const text = "<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>\n\n\nnext";
    expect(parseXml(text)).toEqual([el("command-name", ["/clear"]), el("command-message", ["clear"]), el("command-args", []), "next"]);
    // A blank line ends the run.
    expect(parseXml("<a>x</a>\n\n  <b>y</b>")).toEqual([el("a", ["x"]), "  <b>y</b>"]);
  });

  test("an unclosed fence hides the rest", () => {
    const text = "<doc>\n```\n</doc>";
    expect(parseXml(text)).toEqual([text]);
  });

  test("keeps mid-line tags as text", () => {
    const text = "press <kbd>Ctrl</kbd> now\nreturns Vec<T> or <a@b.com> or <https://x.com>\n\\<tag>\nx\n</tag>";
    expect(parseXml(text)).toEqual([text]);
  });

  test("keeps unmatched tags as literal text", () => {
    expect(parseXml("<br>\ntext")).toEqual(["<br>\ntext"]);
    expect(parseXml("text\n</orphan>")).toEqual(["text\n</orphan>"]);
    expect(parseXml("<a>\n<br>\nx\n</a>")).toEqual([el("a", ["<br>\nx"])]);
    expect(parseXml("<a>\n<b>\nx\n</a>\n</b>")).toEqual([el("a", ["<b>\nx"]), "</b>"]);
  });

  test("keeps self-closing tags as text", () => {
    expect(parseXml("<foo/>\n<bar />")).toEqual(["<foo/>\n<bar />"]);
  });

  test("tag names are case-sensitive", () => {
    const text = "<Doc>\nx\n</doc>";
    expect(parseXml(text)).toEqual([text]);
  });
});
