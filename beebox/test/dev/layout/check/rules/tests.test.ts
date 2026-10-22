// # Test placement (rule 8)
//
// `testsRule` enforces one source root with a test root that mirrors it
// directory-for-directory (`docs/plans/file-layout.md` rule 8). A test is
// placed by the subject it NAMES, not by what it imports for setup.
// Each check states the findings in full, so the wording a boxholder sees is pinned.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { testsRule } from "../../../../../src/dev/layout/check/rules/tests.js";
import { layout } from "./fixture.js";

// ## Clean: a single module named by two facets
void test("Clean: a single module named by two facets", async (t) => {
  const clean1 = layout({
    files: {
      "src/core/chat/session/history.ts": {},
      "test/core/chat/session/history.test.ts": { test: ["src/core/chat/session/history.ts"] },
      "test/core/chat/session/history.archive.test.ts": { test: ["src/core/chat/session/history.ts"] },
    },
  });
  t.check(testsRule.check(clean1), []);
});

// ## Clean: a test named for a subdirectory, not a module
void test("Clean: a test named for a subdirectory, not a module", async (t) => {
  const clean2 = layout({
    files: {
      "src/core/chat/session/history.ts": {},
      "test/core/chat/session.lifecycle.test.ts": { test: [] },
    },
  });
  t.check(testsRule.check(clean2), []);
});

// ## Clean: a named test importing collaborators from elsewhere and a type
//
// Naming no longer counts imports: `agent.test.ts` names `agent.ts` in its
// own mirror, so importing a value from another area and a type from `shared`
// is unrelated to placement.
void test("Naming no longer counts imports:", async (t) => {
  const clean3 = layout({
    files: {
      "src/core/agent/agent.ts": {},
      "src/core/other/fake.ts": {},
      "src/shared/types.ts": {},
      "test/core/agent/agent.test.ts": {
        test: ["src/core/agent/agent.ts", "src/core/other/fake.ts", "type:src/shared/types.ts"],
      },
    },
  });
  t.check(testsRule.check(clean3), []);
});

// ## Finding: `source-roots` — an extra source root
void test("Finding: `source-roots` — an extra source root", async (t) => {
  const extraRoot = layout({
    files: { "src/core/x.ts": {} },
    extraSourceRoots: ["scripts"],
  });
  const extraRootFindings = testsRule.check(extraRoot);
  t.check(extraRootFindings, [
    {
      rule: "source-roots",
      path: "pkg/scripts",
      message: "second source root; fold it into pkg/src so tests have one tree to mirror",
    },
  ]);
});

// ## Finding: `test-placement` — a test outside the test root
void test("Finding: `test-placement` — a test outside the test root", async (t) => {
  const outsideRoot = layout({
    files: {
      "src/core/x.ts": {},
      "core/loose.test.ts": { test: [] },
    },
  });
  const outsideRootFindings = testsRule.check(outsideRoot);
  t.check(outsideRootFindings, [
    {
      rule: "test-placement",
      path: "pkg/core/loose.test.ts",
      message: "tests live under pkg/test, mirroring the source path",
    },
  ]);
});

// ## Finding: `test-naming` — a flattened prefix name
void test("Finding: `test-naming` — a flattened prefix name", async (t) => {
  const flattened = layout({
    files: {
      "src/core/chat/session/archive.ts": {},
      "test/core/chat-session-archive.test.ts": { test: ["src/core/chat/session/archive.ts"] },
    },
  });
  const flattenedFindings = testsRule.check(flattened);
  t.check(flattenedFindings, [
    {
      rule: "test-naming",
      path: "pkg/test/core/chat-session-archive.test.ts",
      message: "chat-session-archive.test.ts names no module or directory in pkg/src/core; name it subject.facet.ext after the module or directory it tests",
    },
  ]);
});

// ## Finding: `test-structure` — the group's top directory has a source counterpart
//
// `test/core/misc` is not an exact mirror, and its top segment below `test`
// (`test/core`) mirrors `src/core`, which exists — so it is not a legitimate
// scenario group; the test belongs somewhere under the `core` mirror instead.
void test("test/core/misc is not an exact mirror, and its top segment below test (test/c...", async (t) => {
  const misplacedGroup = layout({
    files: {
      "src/core/thing.ts": {},
      "test/core/misc/x.test.ts": { test: [] },
    },
  });
  const misplacedGroupFindings = testsRule.check(misplacedGroup);
  t.check(misplacedGroupFindings, [
    {
      rule: "test-structure",
      path: "pkg/test/core/misc/x.test.ts",
      message: "pkg/test/core/misc has no source counterpart; move this test to the mirror of the module it tests",
    },
  ]);
});

// ## Clean: a scenario group may import source modules
//
// `test/tours` has no source counterpart, so it is a scenario group. Its tests
// name a scenario, not a module, and import whatever they need for setup and
// assertions.
void test("test/tours has no source counterpart, so it is a scenario group.", async (t) => {
  const scenarioTour = layout({
    files: {
      "src/core/x.ts": {},
      "test/tours/y.tour.ts": { test: ["src/core/x.ts"] },
    },
  });
  t.check(testsRule.check(scenarioTour), []);
});

// ## Finding: a non-mirror group named after a nested package
//
// `test/frontend` has no source counterpart (`src/frontend` is a nested
// package, excluded from this layout): a group named after a nested package
// or a second source root is not a scenario group, since it mirrors code
// that has, or will have, its own test tree. This is decided by the group's
// name alone, not by what the test inside it imports.
void test("test/frontend has no source counterpart (src/frontend is a nested package, ex...", async (t) => {
  const nestedNonMirror = layout({
    files: {
      "test/frontend/lib/x.test.ts": { test: ["src/frontend/src/lib/docling.ts"] },
    },
    nestedPackages: ["src/frontend"],
  });
  const nestedNonMirrorFindings = testsRule.check(nestedNonMirror);
  t.check(nestedNonMirrorFindings, [
    {
      rule: "test-structure",
      path: "pkg/test/frontend/lib/x.test.ts",
      message: "pkg/test/frontend mirrors the nested package pkg/src/frontend; its tests belong in pkg/src/frontend/test",
    },
  ]);
});

void test("Finding: a non-mirror group named after a nested package", async (t) => {
  const extraRootGroup = layout({
    files: {
      "scripts/migrate/file.ts": {},
      "test/scripts/migrate/file.test.ts": { test: ["scripts/migrate/file.ts"] },
    },
    extraSourceRoots: ["scripts"],
  });
  t.check(testsRule.check(extraRootGroup), [
    {
      rule: "source-roots",
      path: "pkg/scripts",
      message: "second source root; fold it into pkg/src so tests have one tree to mirror",
    },
    {
      rule: "test-structure",
      path: "pkg/test/scripts/migrate/file.test.ts",
      message: "pkg/test/scripts mirrors the second source root pkg/scripts; fold that root into pkg/src and mirror it there",
    },
  ]);
});

// ## Finding: `support-placement` — a helper placed above its only users
void test("Finding: `support-placement` — a helper placed above its only users", async (t) => {
  const misplacedHelper = layout({
    files: {
      "src/core/agent/agent.ts": {},
      "test/core/helper.ts": {},
      "test/core/agent/agent.test.ts": {
        test: ["src/core/agent/agent.ts", "test/core/helper.ts"],
      },
    },
  });
  const misplacedHelperFindings = testsRule.check(misplacedHelper);
  t.check(misplacedHelperFindings, [
    {
      rule: "support-placement",
      path: "pkg/test/core/helper.ts",
      message: "used by tests under pkg/test/core/agent; move it to pkg/test/core/agent/ (or a support directory directly under it)",
    },
  ]);
});
