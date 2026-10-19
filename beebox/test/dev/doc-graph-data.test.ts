// # Documentation graph external-reference resolution
//
// Monorepo documents outside the external-source scan roots are still valid link
// targets. Resolving one does not require adding it to the source scan, while a
// missing target or a relative path that escapes the monorepo stays unresolved.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveExternalRef, type ExternalResolveContext } from "../../src/dev/doc-graph-data/data.js";

const context: ExternalResolveContext = {
  fromFile: "AGENTS.md",
  internalFiles: [],
  externalFiles: [],
  internalBasenames: new Map(),
  externalBasenames: new Map(),
};

void test("line 19", async (t) => {
  // doctest:L20
  t.check(resolveExternalRef("beebox-clerk/AGENTS.md", context), [
    "../beebox-clerk/AGENTS.md",
    true,
  ]);

  // doctest:L23
  t.check(resolveExternalRef("missing-package/AGENTS.md", context), [
    "missing-package/AGENTS.md",
    false,
  ]);

  // doctest:L26
  t.check(resolveExternalRef("../outside-the-monorepo.md", context), [
    "../outside-the-monorepo.md",
    false,
  ]);
});

// A target that does not exist at its relative path falls back to its basename,
// and only a basename unique across the beebox docs and the monorepo sources
// resolves. Before this check, a basename with several beebox candidates and one
// monorepo candidate resolved to that one: a closed issue's stale link to a
// journey report `2026-10-09.md` passed `doc-check` by pointing at a research
// run of the same name (2026-10-11). Ambiguous in either pool, or across both,
// stays unresolved:
void test("A target that does not exist at its relative path falls back to its basename,...", async (t) => {
  // doctest:L39
  const ambiguous: ExternalResolveContext = {
    fromFile: "issues/closed/bugs/x.md",
    internalFiles: ["test/journeys/A/reports/2026-10-09.md", "test/journeys/B/reports/2026-10-09.md", "docs/unique.md"],
    externalFiles: ["research/runs/2026-10-09.md"],
    internalBasenames: new Map([["2026-10-09.md", ["test/journeys/A/reports/2026-10-09.md", "test/journeys/B/reports/2026-10-09.md"]], ["unique.md", ["docs/unique.md"]]]),
    externalBasenames: new Map([["2026-10-09.md", ["research/runs/2026-10-09.md"]]]),
  };
  t.check(resolveExternalRef("../../beebox/test/journeys/A/reports/2026-10-09.md", ambiguous), [
    "../../beebox/test/journeys/A/reports/2026-10-09.md",
    false,
  ]);

  // doctest:L49
  t.check(resolveExternalRef("../../beebox/docs/unique.md", ambiguous), [
    "docs/unique.md",
    true,
  ]);
});
