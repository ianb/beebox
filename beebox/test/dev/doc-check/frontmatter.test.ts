// # Plan and issue frontmatter validation
//
// The documentation schema is enforced independently of the filesystem; tests
// inject the set of paths that resolve.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { frontmatterProblems } from "../../../src/dev/doc-check/frontmatter.js";

const files = new Set(["issues/features/x.md", "beebox/docs/plans/next.md"]);
const check = (rel: string, source: string) => frontmatterProblems({ rel, source, exists: (target) => files.has(target) });

// ## A complete plan validates
void test("A complete plan validates", async (t) => {
  t.check(
    check("beebox/docs/plans/current.md", `---
title: Current
status: active
workstream: current
issues:
  - ../../../issues/features/x.md
---
# Current`),
    [],
  );
});

// ## Directory status and paths are enforced
void test("Directory status and paths are enforced", async (t) => {
  t.check(
    check("beebox/docs/implemented-plans/current.md", `---
title: Current
status: active
workstream: current
issues: [missing.md]
---
# Current`),
    [
      "beebox/docs/implemented-plans/current.md: status active is not allowed in implemented-plans; implemented-plans requires implemented",
      "beebox/docs/implemented-plans/current.md: frontmatter issues does not resolve: missing.md",
    ],
  );
});

// Every plan directory accepts only its lifecycle states. README files and
// companion review documents remain exempt.
void test("Every plan directory accepts only its lifecycle states.", async (t) => {
  t.check(
    check("beebox/docs/plans/done.md", `---
title: Done
status: implemented
workstream: done
issues: []
---`),
    ["beebox/docs/plans/done.md: status implemented is not allowed in plans; plans requires draft, active, partial"],
  );

  t.check(
    check("beebox/docs/unimplemented-plans/later.md", `---
title: Later
status: parked
workstream: later
issues: []
---`),
    [],
  );

  t.check(check("beebox/docs/plans/README.md", "No frontmatter"), []);

  t.check(check("beebox/docs/implemented-plans/current.review.md", "No frontmatter"), []);

  t.check(
    check("beebox/docs/implemented-plans/current.gap-analysis.md", `---
title: Historical review
---`),
    [],
  );

  t.check(check("beebox/docs/plans/missing.md", "# Missing"), ["beebox/docs/plans/missing.md: YAML frontmatter is required"]);

  t.check(
    check("beebox/docs/plans/malformed.md", `---
title: [
---`),
    ["beebox/docs/plans/malformed.md: invalid YAML frontmatter: unexpected end of the stream within a flow collection (2:1)\n\n 1 | title: [\n 2 | \n-----^"],
  );
});

// ## Closed issues require a resolution
void test("Closed issues require a resolution", async (t) => {
  t.check(
    check("issues/closed/bugs/x.md", `---
title: X
workstream: unknown
---
Body`),
    ["issues/closed/bugs/x.md: closed issues require a valid resolution"],
  );
});

// ## Manual-testing flags require an addressable procedure section
void test("Manual-testing flags require an addressable procedure section", async (t) => {
  t.check(
    check("issues/bugs/x.md", `---
title: X
workstream: x
needs: [manual-testing]
---
Try it.`),
    ["issues/bugs/x.md: needs manual-testing requires a ## Manual testing section"],
  );
});

// ## Issue priority uses the documented vocabulary
//
// Omission means normal, while an authored value must be exact.
void test("Omission means normal, while an authored value must be exact.", async (t) => {
  t.check(
    check("issues/features/x.md", `---
title: X
workstream: unattached
---
Body`),
    [],
  );

  t.check(
    check("issues/features/x.md", `---
title: X
workstream: unattached
priority: urgent
---
Body`),
    ["issues/features/x.md: priority must be important, normal, or backlog"],
  );
});

// ## Deferred issues require their activation metadata
void test("Deferred issues require their activation metadata", async (t) => {
  t.check(
    check("issues/deferred/x.md", `---
title: X
workstream: unattached
activate-on: 2026-09-07
category: code-quality
---
Body`),
    [],
  );

  t.check(
    check("issues/deferred/x.md", `---
title: X
workstream: unattached
activate-on: 2026-02-30
category: someday
---
Body`),
    [
      "issues/deferred/x.md: deferred issues require activate-on as a valid YYYY-MM-DD date",
      "issues/deferred/x.md: deferred issues require a valid category",
    ],
  );
});

// The fields do not survive the move into the active queue.
void test("The fields do not survive the move into the active queue.", async (t) => {
  t.check(
    check("issues/features/x.md", `---
title: X
workstream: unattached
activate-on: 2026-09-07
category: features
---
Body`),
    [
      "issues/features/x.md: activate-on is allowed only on deferred issues",
      "issues/features/x.md: category is allowed only on deferred issues",
    ],
  );
});
