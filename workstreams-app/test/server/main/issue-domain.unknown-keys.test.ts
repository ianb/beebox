// # Unknown frontmatter keys are reported, not swallowed
//
// `issues/AGENTS.md` defines a closed frontmatter schema, but `parseIssueFile` used
// to drop anything outside it without a word. Eleven issues were filed carrying a
// `stories:` list — pointing at slugs in the user-story catalog — and it reached no
// tool for two months: not a filter, not a facet, not `--json`. Nobody was told,
// because nothing said anything.
//
// So the parser now reports what it did not recognise, and callers decide how loudly.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseIssueFile } from "../../../src/server/main/issue-domain.js";

const parse = (frontmatter: string) => parseIssueFile({
  relPath: "bugs/2026-08-24-example.md",
  source: `---\n${frontmatter}\n---\n\nThe body.\n`,
});

// ## A key outside the schema is named
void test("A key outside the schema is named", async (t) => {
  // doctest:L23
  t.check(
    parse([
      'title: "Something broke"',
      "workstream: unattached",
      "stories: [connectors/configure-which-gmail-calendar-and-drive-content]",
    ].join("\n")).unknownKeys,
    [
    "stories",
  ],
  );
});

// ## Several are sorted, so the report is stable
void test("Several are sorted, so the report is stable", async (t) => {
  // doctest:L34
  t.check(
    parse([
      'title: "Something broke"',
      "workstream: unattached",
      "zebra: 1",
      "apple: 2",
    ].join("\n")).unknownKeys,
    [
    "apple",
    "zebra",
  ],
  );
});

// ## Every documented field is recognised
//
// If this list and `issues/AGENTS.md` drift apart, a legitimate field starts being
// reported as unknown on every issue that uses it — which is the failure this whole
// mechanism would otherwise cause.
void test("If this list and issues/AGENTS.md drift apart, a legitimate field starts bein...", async (t) => {
  // doctest:L50
  t.check(
    parse([
      'title: "Something broke"',
      "workstream: unattached",
      "needs: [design]",
      "design: ../../beebox/docs/plans/foo.md",
      "area: beebox",
      "labels: [soft-launch]",
      "priority: important",
      "filed-by: agent",
      "discovered-by: agent",
      "discovered-in: worktree-foo — while doing X",
      "resolution: implemented",
    ].join("\n")).unknownKeys,
    [],
  );
});

// ## A retired field is reported like any other
//
// Next actions moved to a local store outside git. A `next-action:` line left on
// an old branch is therefore unknown, so it surfaces instead of silently doing
// nothing.
void test("Next actions moved to a local store outside git.", async (t) => {
  // doctest:L73
  t.check(
    parse([
      'title: "Something broke"',
      "workstream: unattached",
      "next-action: discuss",
    ].join("\n")).unknownKeys,
    [
    "next-action",
  ],
  );
});
