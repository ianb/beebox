// # Validation ignore: _config/bbx-validate.ignore + color gating
//
// `loadValidationIgnore` reads the box's operator-owned `_config/bbx-validate.ignore`
// (a gitignore-style file — the `.gitignore` analogue for `bbx validate`) and
// returns a matcher. When the file is absent the matcher allows everything, so the
// common case (no file) costs nothing.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { loadValidationIgnore } from "../../src/core/validation-ignore.js";
import { useColor } from "../../src/cli/commands/validate/report.js";
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

// ## Color gating
//
// `useColor` emits ANSI only for a real terminal and never when `NO_COLOR` is set.
// Under the test harness stdout is piped (not a TTY), so it stays off — the common
// piped/pasted case gets clean, escape-free output:
void test("useColor emits ANSI only for a real terminal and never when NOCOLOR is set.", async (t) => {
  t.check(useColor(), false);
});

// Force a TTY to exercise the terminal branch, and confirm `NO_COLOR` still wins:
void test("Force a TTY to exercise the terminal branch, and confirm NOCOLOR still wins:", async (t) => {
  const orig = process.stdout.isTTY;
  process.stdout.isTTY = true;
  const noEnv = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const onTty = useColor();
  process.env.NO_COLOR = "1";
  const withNoColor = useColor();
  if (noEnv === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = noEnv;
  process.stdout.isTTY = orig;
  t.check([onTty, withNoColor], [
    true,
    false,
  ]);
});
