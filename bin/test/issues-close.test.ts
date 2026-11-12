// # Closing an issue's source
//
// `closedSource` sets `resolution:` and `workstream:` without reserializing
// the YAML, and puts the closing note first in the body. The move and the
// link rewrites are doc-move's (bin/test/lib/doc-move.test.ts).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { closedSource } from "../issues-close.js";

const open = `---
title: "Keep me"
workstream: unattached
labels: [issues]
---

The tension.
`;

void test("The note opens the body and resolution is the last frontmatter line", async (t) => {
  t.check(closedSource(open, { resolution: "implemented", workstream: "tooling-burndown", note: "Landed in abc123.", date: "2026-10-29" }), `---
title: "Keep me"
workstream: tooling-burndown
labels: [issues]
resolution: implemented
---

**Closed (implemented, 2026-10-29):** Landed in abc123.

The tension.
`);
});

void test("A stray resolution is replaced, and no workstream keeps the existing one", async (t) => {
  const stray = open.replace("labels: [issues]\n", "resolution: wontfix\nlabels: [issues]\n");
  t.check(closedSource(stray, { resolution: "superseded", workstream: null, note: "See the newer issue.", date: "2026-10-29" }), `---
title: "Keep me"
workstream: unattached
resolution: superseded
labels: [issues]
---

**Closed (superseded, 2026-10-29):** See the newer issue.

The tension.
`);
});

void test("An issue without frontmatter is refused", async (t) => {
  await t.checkThrows(() => closedSource("No frontmatter.\n", { resolution: "implemented", workstream: null, note: "x", date: "2026-10-29" }), "MissingIssueFrontmatterError: issue has no YAML frontmatter");
});
