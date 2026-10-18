// # Unsaved issue changes
//
// Issue edits prompt before navigation would unmount the issues page. Search-only
// navigation within that page keeps the same editor state and does not prompt.

import { test } from "tap";
import "agent-doctest/tap";
import { issueNavigationGuard } from "../../../src/frontend/pages/IssuesPage.js";

const clean = issueNavigationGuard(false);
const dirty = issueNavigationGuard(true);
let confirmations = 0;
const navigation = { currentRouteId: "/issues", nextRouteId: "/streams" };

void test("line 15", async (t) => {
  // doctest:L16
  t.check(
    {
      cleanDisabled: clean.disabled,
      cleanBeforeUnload: clean.enableBeforeUnload,
      dirtyDisabled: dirty.disabled,
      dirtyBeforeUnload: dirty.enableBeforeUnload,
      rejectedLeave: dirty.shouldBlock({ ...navigation, confirmDiscard: () => { confirmations += 1; return false; } }),
      acceptedLeave: dirty.shouldBlock({ ...navigation, confirmDiscard: () => true }),
      dirtyIssueSearch: dirty.shouldBlock({ currentRouteId: "/issues", nextRouteId: "/issues", confirmDiscard: () => { confirmations += 1; return false; } }),
      confirmations,
    },
    {
    cleanDisabled: true,
    cleanBeforeUnload: false,
    dirtyDisabled: false,
    dirtyBeforeUnload: true,
    rejectedLeave: true,
    acceptedLeave: false,
    dirtyIssueSearch: false,
    confirmations: 1,
  },
  );
});
