// # Validation ignore: _config/bbx-validate.ignore
//
// `loadValidationIgnore` reads the box's operator-owned `_config/bbx-validate.ignore`
// (a gitignore-style file — the `.gitignore` analogue for `bbx validate`) and
// returns a matcher. When the file is absent the matcher allows everything, so the
// common case (no file) costs nothing.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { loadValidationIgnore } from "../../src/core/validation-ignore.js";
import { formatLintResults } from "../../src/exports/cards.js";
import { formatUrlReport } from "../../src/core/external/url-check/core.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// No ignore file → allow-all (nothing is ignored):
void test("No ignore file → allow-all (nothing is ignored):", async (t) => {
  const box = await makeTmpBox();
  const ig = await loadValidationIgnore(box.root);
  t.check([ig.isIgnored("_content/anything.md"), ig.isIgnored(join(box.root, "vendor/x.md"))], [
    false,
    false,
  ]);

  await box.cleanup();
});

// With patterns, matching paths are ignored and others aren't. Both box-relative
// and absolute paths resolve against the box root:
void test("With patterns, matching paths are ignored and others aren't.", async (t) => {
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_config"), { recursive: true });
  await writeFile(join(box.root, "_config/bbx-validate.ignore"), "# a comment\nvendor/**\n_content/imported/**/*.md\n");
  const ig = await loadValidationIgnore(box.root);
  t.check(
    [
      ig.isIgnored("vendor/docs/readme.md"),
      ig.isIgnored(join(box.root, "vendor/docs/readme.md")),
      ig.isIgnored("_content/imported/data/notes.md"),
      ig.isIgnored("_content/real/note.md"),
    ],
    [
    true,
    true,
    true,
    false,
  ],
  );

  // Paths outside the box root (or empty) are never ignored — the matcher only
  // speaks to box-relative content:

  t.check([ig.isIgnored("/etc/passwd"), ig.isIgnored("")], [
    false,
    false,
  ]);

  await box.cleanup();
});

// ## Plain output
//
// `bbx validate` output carries no ANSI escapes, on a terminal or off one:
void test("validate report formatters emit no ANSI escapes.", async (t) => {
  const lint = formatLintResults({
    results: [{ path: "a.md", errors: [{ severity: "error", type: "schema", message: "bad", location: { source: "", startLine: 1, startColumn: 2, endLine: 1, endColumn: 3 } }], warnings: [] }],
    totalErrors: 1,
    totalWarnings: 0,
    filesChecked: 1,
    filesWithErrors: 1,
  });
  const urls = formatUrlReport({ checked: 2, broken: [{ url: "https://x.test", status: 404, detail: "404", referrers: ["a.md"] }], transient: ["https://y.test"] });
  t.check([lint.includes("\u001B"), (urls ?? "").includes("\u001B")], [false, false]);
  t.check(urls, "broken  https://x.test  [404]  (a.md)\ntransient  https://y.test  (unreachable this run — will retry)\n\n1 broken external URL (warning — not blocking; fix or remove the link)");
});
