// # A code file's text, coloured by language
//
// CodeText paints the source uncoloured, then swaps in highlight.js markup when
// the grammar loads. The markup keeps every character of the source (markup in
// the source stays text, CRLF stays CRLF), a result for older text is never shown after the
// text changes, and text over HIGHLIGHT_LIMIT is never coloured.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { CodeText, HIGHLIGHT_LIMIT, shouldHighlight } from "../../../src/components/CodeText/view.js";

// CRLF line ends survive the swap to markup (HTML parsing would turn them into LF).
const source = 'const tag = "<script>alert(1)</script>"; // note\r\nlet x = 1;\r\n';

function shown(container: HTMLElement): { text: string; coloured: boolean; scripts: number } {
  const pre = container.querySelector("pre");
  return { text: pre?.textContent ?? "", coloured: pre?.querySelector("code .hljs-keyword") !== null, scripts: container.querySelectorAll("script").length };
}

void test("TypeScript is coloured; markup in the source stays text", async (t) => {
  const view = await mount(h(CodeText, { text: source, grammar: "typescript" }));
  t.teardown(() => view.unmount());
  await eventually(() => shown(view.container).coloured || undefined, { label: "highlighted" });
  t.check(shown(view.container), { text: source, coloured: true, scripts: 0 });

  // New text (the file changed on disk) shows uncoloured at once, never the old markup.
  const next = "let n = 2;\n";
  await view.rerender(h(CodeText, { text: next, grammar: "typescript" }));
  t.check(shown(view.container).text, next);
  await eventually(() => shown(view.container).coloured || undefined, { label: "re-highlighted" });
  t.check(shown(view.container), { text: next, coloured: true, scripts: 0 });
});

void test("highlighting runs only for a grammar and text within the limit", async (t) => {
  const cases: [string, number, "typescript" | null][] = [["empty", 0, "typescript"], ["at limit", HIGHLIGHT_LIMIT, "typescript"], ["over limit", HIGHLIGHT_LIMIT + 1, "typescript"], ["no grammar", 10, null]];
  // HTML parsing would drop a NUL character, so text with one is not coloured.
  t.check(shouldHighlight("a\0b", "typescript"), false);
  t.check(cases.map(([name, size, grammar]) => [name, shouldHighlight("x".repeat(size), grammar)]), [
    ["empty", false],
    ["at limit", true],
    ["over limit", false],
    ["no grammar", false],
  ]);
});
