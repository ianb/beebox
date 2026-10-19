// # Assigning an issue to a workstream
//
// The launcher changes only the required `workstream` frontmatter field and
// preserves the rest of the issue exactly.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { assignIssueWorkstream } from "../assign-issue-workstream.js";

void test("line 10", async (t) => {
  // doctest:L11
  const source = "---\ntitle: Keep me\nworkstream: unattached\nneeds: [manual-testing]\n---\n\nBody.\n";
  t.check(assignIssueWorkstream(source, "seam"), `---
title: Keep me
workstream: seam
needs: [manual-testing]
---

Body.
`);

  // doctest:L15
  const empty = "---\ntitle: Keep me\nworkstream:\nneeds: [manual-testing]\n---\n";
  t.check(assignIssueWorkstream(empty, "seam"), `---
title: Keep me
workstream: seam
needs: [manual-testing]
---
`);
});
