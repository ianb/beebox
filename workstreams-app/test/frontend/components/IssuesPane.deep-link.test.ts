// # Issue deep-link visibility
//
// A deep link with no explicit status filter includes the selected issue alongside
// the default open queue, so a closed issue has a rendered sidebar row for the
// scroll effect to target. An explicit filter remains authoritative.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { issuePassesStatusFilter, missingIssueRelPath } from "../../../src/frontend/components/IssuesPane/panel.js";
import type { Issue } from "../../../src/shared/documents.js";

function issueAt(relPath: string): Issue {
  return {
    relPath,
    category: "bugs",
    closed: false,
    slug: "a",
    visibility: "public",
    research: "none",
    frontmatter: { title: "A", workstream: "none", needs: [], labels: [], priority: "normal" },
  };
}

void test("line 24", async (t) => {
  t.check(
    {
      selectedClosedDeepLink: issuePassesStatusFilter({ closed: true }, { status: undefined, selected: true }),
      otherClosedIssue: issuePassesStatusFilter({ closed: true }, { status: undefined, selected: false }),
      ordinaryOpenIssue: issuePassesStatusFilter({ closed: false }, { status: undefined, selected: false }),
      explicitOpen: issuePassesStatusFilter({ closed: true }, { status: "open", selected: true }),
      explicitClosed: issuePassesStatusFilter({ closed: true }, { status: "closed", selected: true }),
    },
    {
    selectedClosedDeepLink: true,
    otherClosedIssue: false,
    ordinaryOpenIssue: true,
    explicitOpen: false,
    explicitClosed: true,
  },
  );
});

// A deep link can also name an issue the queue does not hold — the recency feed
// and quick-open address a file the moment it changes, while the list rides a
// 60-second snapshot, and a worktree that deleted or renamed an issue leaves a
// row at the old path. That is reported as a miss rather than falling through to
// the "select an issue" prompt, which would read as an empty queue.
void test("A deep link can also name an issue the queue does not hold — the recency feed...", async (t) => {
  t.check(
    {
      requestedAndFound: missingIssueRelPath({ requested: "bugs/a.md", selected: issueAt("bugs/a.md") }),
      requestedAndAbsent: missingIssueRelPath({ requested: "bugs/gone.md", selected: undefined }),
      nothingRequested: missingIssueRelPath({ requested: undefined, selected: undefined }),
    },
    {
    requestedAndFound: null,
    requestedAndAbsent: "bugs/gone.md",
    nothingRequested: null,
  },
  );
});
