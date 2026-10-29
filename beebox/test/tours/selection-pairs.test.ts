// Selection color pairs: a theme rule that sets a selection background sets
// its ink in the same rule, and hex pairs meet AA. Then every shipped theme
// stylesheet and studio study, read from source.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "tap";
import { declarationBlocks, selectionPairProblems } from "./tour-lib/selection-pairs.js";

const FRONTEND = path.resolve(import.meta.dirname, "../../src/frontend/src");

function problems(css: string): string[] {
  return selectionPairProblems(declarationBlocks(css, "t.css"));
}

void test("blocks carry their selector, first line and custom properties; comments, strings and at-rules are skipped", (t) => {
  const css = `/* a { --bbx-selection: #000 } */
.a { --bbx-selection: #fff; --bbx-selection-ink: #000; color: red }
@media print {
  .b,
  .c[title="{ ; }"] { --bbx-selection: initial !important; }
}`;
  t.check(declarationBlocks(css, "t.css").map(({ line, selector, tokens }) => ({ line, selector, tokens: Object.fromEntries(tokens) })), [
    { line: 2, selector: ".a", tokens: { "--bbx-selection": "#fff", "--bbx-selection-ink": "#000" } },
    { line: 4, selector: ".b,\n  .c[title=\"{ ; }\"]", tokens: { "--bbx-selection": "initial" } },
  ]);
  t.end();
});

void test("half a pair is a problem; so is resetting one half with initial", (t) => {
  t.check(problems(".a { --bbx-selection: #222; }\n.b { --bbx-selection-code-ink: #fff; }\n.c { --bbx-selection: initial; --bbx-selection-ink: #000; }"), [
    "t.css:1 .a: sets --bbx-selection without --bbx-selection-ink",
    "t.css:2 .b: sets --bbx-selection-code-ink without --bbx-selection-code",
    "t.css:3 .c: resets one of --bbx-selection and --bbx-selection-ink with initial",
  ]);
  t.end();
});

// #777 on #fff is 4.48:1, just under AA. var() pairs are left to theme-check.
void test("a hex pair below AA is a problem; whole resets and var() pairs are not checked here", (t) => {
  t.check(problems(`.a { --bbx-selection: #fff; --bbx-selection-ink: #777; }
.b { --bbx-selection: #fff; --bbx-selection-ink: #767676; }
.c { --bbx-selection-code: initial; --bbx-selection-code-ink: initial; }
.d { --bbx-selection: var(--x); --bbx-selection-ink: var(--y); }`), [
    "t.css:1 .a: --bbx-selection-ink #777 on --bbx-selection #fff is 4.48:1 < 4.5",
  ]);
  t.end();
});

void test("every shipped theme and studio study pairs its selection colors", async (t) => {
  const files = [
    ...(await readdir(path.join(FRONTEND, "themes"))).map((f) => path.join("themes", f)),
    ...(await readdir(path.join(FRONTEND, "pages/dev"))).map((f) => path.join("pages/dev", f)),
  ].filter((f) => f.endsWith(".css"));
  const blocks = (await Promise.all(files.map(async (f) => declarationBlocks(await readFile(path.join(FRONTEND, f), "utf8"), f)))).flat();
  t.check(selectionPairProblems(blocks), []);
  t.end();
});
