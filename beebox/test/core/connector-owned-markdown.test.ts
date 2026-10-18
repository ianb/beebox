// # Connector-owned markdown is exempt from lint
//
// A gdoc card's markdown is Google's export mirrored into the card's attach
// scope, and the connector pushes whatever is on disk back upstream.
// Linting it gates commits on a file nobody wrote — and invites the "fix the lint
// error" edit that destroyed two Google Docs (`issues/bugs/2026-09-16-drive-doc-round-trip-destroyed-by-lint-driven-whitespace-edit.md`).

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import {
  isConnectorOwnedMarkdown,
  connectorOwnedEditWarning,
} from "../../src/core/connector-owned-markdown.js";
import { lintMarkdownFiles } from "../../src/cli/validate-markdown.js";
import { join } from "node:path";
import type { LintError } from "markdownlint";

const NOT_LINTED = { filesChecked: 0, filesWithErrors: 0, totalErrors: 0, errors: {} };

/** `exported` has two nested-list lines ending in three spaces, where MD009 tolerates 0 or 2. */
function trailingSpaces(lineNumber: number, column: number): LintError {
  return {
    lineNumber,
    ruleNames: ["MD009", "no-trailing-spaces"],
    ruleDescription: "Trailing spaces",
    ruleInformation: "https://github.com/DavidAnson/markdownlint/blob/v0.40.0/doc/md009.md",
    errorDetail: "Expected: 0 or 2; Actual: 3",
    errorContext: null,
    errorRange: [column, 3],
    fixInfo: { editColumn: column, deleteCount: 3 },
    severity: "error",
  };
}

/** The two trailing-space errors `exported` earns when the file is linted. */
function linted(file: string) {
  return {
    filesChecked: 1,
    filesWithErrors: 1,
    totalErrors: 2,
    errors: { [file]: [trailingSpaces(1, 13), trailingSpaces(2, 18)] },
  };
}

// Google's export encodes a line break inside a nested list item as trailing
// spaces, and the run of them is not always the two MD009 tolerates. Inside a
// gdoc's attach scope the file is not linted at all; the identical file beside a
// `doc` card — ordinary authored content — still is:
void test("Google's export encodes a line break inside a nested list item as trailing sp...", async (t) => {
  const box = await makeTmpBox({ git: true });
  const exported = "- [ ] Parent   \n      - [ ] Child   \n";

  await box.seed("_content/drive/Checklist.gdoc.card", "---\ndrive-id: doc-1\n---\n");
  await box.seed("_content/drive/Checklist.attach/Checklist.md", exported);
  await box.seed("_content/notes/Plan.doc.card", "---\ntitle: Plan\n---\n");
  await box.seed("_content/notes/Plan.attach/Plan.md", exported);

  const lint = async (rel: string) =>
    lintMarkdownFiles([join(box.root, rel)], { boxRoot: box.root });

  t.check(await lint("_content/drive/Checklist.attach/Checklist.md"), NOT_LINTED);

  t.check(await lint("_content/notes/Plan.attach/Plan.md"), linted(join(box.root, "_content/notes/Plan.attach/Plan.md")));

  // The exemption covers only what the connector writes and pushes: the card's own
  // `<basename>.md`, and the `<basename>.remote.md` a refused push parks beside it.
  // An agent's notes in the same attach scope are authored content and still lint.

  await box.seed("_content/drive/Checklist.attach/Checklist.remote.md", exported);
  await box.seed("_content/drive/Checklist.attach/notes.md", exported);

  t.check(await lint("_content/drive/Checklist.attach/Checklist.remote.md"), NOT_LINTED);

  t.check(await lint("_content/drive/Checklist.attach/notes.md"), linted(join(box.root, "_content/drive/Checklist.attach/notes.md")));

  // It is decided by the owner card, not the directory name, so an attach scope
  // whose owner card is gone is ordinary content again:

  await box.seed("_content/orphan/Gone.attach/Gone.md", exported);

  t.check(await lint("_content/orphan/Gone.attach/Gone.md"), linted(join(box.root, "_content/orphan/Gone.attach/Gone.md")));

  // The owner card itself is not connector-owned markdown:

  t.check(await isConnectorOwnedMarkdown(join(box.root, "_content/drive/Checklist.gdoc.card")), false);

  // A mixed batch lints the authored file and skips the connector-owned one, so the
  // box-wide and staged passes stay useful:

  const summary = await lintMarkdownFiles(
    [
      join(box.root, "_content/drive/Checklist.attach/Checklist.md"),
      join(box.root, "_content/notes/Plan.attach/Plan.md"),
    ],
    { boxRoot: box.root },
  );
  t.check(summary, linted(join(box.root, "_content/notes/Plan.attach/Plan.md")));

  await box.cleanup();
});

// The same predicate drives what an agent is told when it writes to one of these
// files — the moment the edit is still the current thought, rather than a rule
// read long beforehand:
void test("The same predicate drives what an agent is told when it writes to one of thes...", async (t) => {
  const warning = connectorOwnedEditWarning("/box/_content/drive/Checklist.attach/Checklist.md");
  await t.checkText(warning, `Checklist.md is connector-owned content, not an authored file.
It mirrors an upstream document, and the next sync pushes whatever is on disk back out — replacing the upstream copy.
- Never edit it to satisfy a linter or a formatter. Lint does not run on these files; a lint failure here is an engine bug to report, not a file to repair.
- Invisible formatting carries structure upstream: trailing spaces are line breaks inside nested lists, and stripping them collapses checklists into paragraphs. Leave them alone even when making a real edit — a push that removes them is refused.
- An empty \`lossy:\` on the card does NOT mean an edit is safe. It means none of six specific features (comments, footnotes, images, equations, suggestions, tables) were found — it says nothing about list structure.
Edit it only to change what the document says, on purpose.`);
});
