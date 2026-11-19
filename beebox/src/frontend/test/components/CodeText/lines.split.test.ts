// Splitting a code file into numbered lines: each line keeps its line feed so
// the lines join back to the source, a final line feed adds no empty line, and
// highlight.js spans that cross a line feed are closed and reopened per line.
// A line's indent width sets where its wrapped continuation starts.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { indentWidth, splitHtmlLines, splitTextLines } from "../../../src/components/CodeText/lines.js";

void test("text lines keep their line feeds; a final line feed ends the last line", async (t) => {
  t.check(["a\nb\n", "a\nb", "a\n\nb\n", "", "\n"].map((text) => [text, splitTextLines(text)]), [
    ["a\nb\n", ["a\n", "b\n"]],
    ["a\nb", ["a\n", "b"]],
    ["a\n\nb\n", ["a\n", "\n", "b\n"]],
    ["", [""]],
    ["\n", ["\n"]],
  ]);
});

void test("a span crossing a line feed is balanced on each line", async (t) => {
  const html = 'x <span class="hljs-comment">/* one\ntwo <span class="hljs-doctag">@a</span>\nthree */</span> y\nz';
  t.check(splitHtmlLines(html), [
    'x <span class="hljs-comment">/* one\n</span>',
    '<span class="hljs-comment">two <span class="hljs-doctag">@a</span>\n</span>',
    '<span class="hljs-comment">three */</span> y\n',
    "z",
  ]);
});

void test("indent width counts spaces, and tabs to the next 4-column stop", async (t) => {
  t.check(["x", "  x", "\tx", "  \tx", "    ", ""].map((line) => [line, indentWidth(line)]), [
    ["x", 0],
    ["  x", 2],
    ["\tx", 4],
    // Two spaces then a tab: the tab reaches column 4, not 6.
    ["  \tx", 4],
    ["    ", 4],
    ["", 0],
  ]);
});
