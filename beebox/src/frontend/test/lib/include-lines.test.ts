// Include lines in agent instruction files: which files get them, which lines
// count, and that the rewrite keeps one line per line so heading `data-line`
// and todo locators stay put.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isInstructionFile, rewriteIncludeLines } from "../../src/lib/include-lines.js";

void test("instruction files are AGENTS.md and CLAUDE.md, at any depth", async (t) => {
  t.check(
    ["AGENTS.md", "/_content/AGENTS.md", "_config/feedback/CLAUDE.md", "/_content/notes.md", "/_content/MY-AGENTS.md", undefined].map(isInstructionFile),
    [true, true, true, false, false, false],
  );
});

void test("the stock include lines become tags, one per line", async (t) => {
  const source = "@.beebox/agent-guide.md\n@_content/briefing.md\n# Box\n\nText.\n";
  t.check(
    rewriteIncludeLines(source),
    '{% include-file path=".beebox/agent-guide.md" /%}\n{% include-file path="_content/briefing.md" /%}\n# Box\n\nText.\n',
  );
});

void test("lines that only look like includes stay text", async (t) => {
  // A mention mid-sentence, a space after `@`, trailing words, and a quote in
  // the path (it could not sit in a tag attribute) are all ordinary text.
  const source = "Ask @Priya about it.\n@ MAP.md\n@MAP.md and more\n@a\"b.md\n";
  t.check(rewriteIncludeLines(source), source);
});

void test("an indented fence marker four spaces in does not close the fence", async (t) => {
  // Four spaces is code-block text, not a closing fence (CommonMark: at most three).
  const source = "```\n    ```\n@MAP.md\n```\n";
  t.check(rewriteIncludeLines(source), source);
});

void test("include lines inside fenced code are left alone", async (t) => {
  const source = "```text\n@MAP.md\n```\n@MAP.md\n~~~~\n@x.md\n~~~~\n";
  t.check(
    rewriteIncludeLines(source),
    '```text\n@MAP.md\n```\n{% include-file path="MAP.md" /%}\n~~~~\n@x.md\n~~~~\n',
  );
});
