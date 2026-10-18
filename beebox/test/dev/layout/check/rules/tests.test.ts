// # Test placement (rule 8)
//
// `testsRule` enforces one source root with a test root that mirrors it
// directory-for-directory (`docs/plans/file-layout.md` rule 8). A test is
// placed by the subject it NAMES, not by what it imports for setup.
// `summary()` only prints `rule path`, so most checks here read `.message`
// directly to pin the exact wording a boxholder sees.

import { test } from "tap";
import "agent-doctest/tap";
import { testsRule } from "../../../../../src/dev/layout/check/rules/tests.js";
import { layout, summary } from "./fixture.js";

// ## Clean: a single module named by two facets
void test("Clean: a single module named by two facets", async (t) => {
  // doctest:L17
  const clean1 = layout({
    files: {
      "src/core/chat/session/history.ts": {},
      "test/core/chat/session/history.doctest.md": { test: ["src/core/chat/session/history.ts"] },
      "test/core/chat/session/history.archive.doctest.md": { test: ["src/core/chat/session/history.ts"] },
    },
  });
  await t.checkText(summary(testsRule.check(clean1)) === "", "true");
});

// ## Clean: a test named for a subdirectory, not a module
void test("Clean: a test named for a subdirectory, not a module", async (t) => {
  // doctest:L31
  const clean2 = layout({
    files: {
      "src/core/chat/session/history.ts": {},
      "test/core/chat/session.lifecycle.doctest.md": { test: [] },
    },
  });
  await t.checkText(summary(testsRule.check(clean2)) === "", "true");
});

// ## Clean: a named test importing collaborators from elsewhere and a type
//
// Naming no longer counts imports: `agent.doctest.md` names `agent.ts` in its
// own mirror, so importing a value from another area and a type from `shared`
// is unrelated to placement.
void test("Naming no longer counts imports:", async (t) => {
  // doctest:L48
  const clean3 = layout({
    files: {
      "src/core/agent/agent.ts": {},
      "src/core/other/fake.ts": {},
      "src/shared/types.ts": {},
      "test/core/agent/agent.doctest.md": {
        test: ["src/core/agent/agent.ts", "src/core/other/fake.ts", "type:src/shared/types.ts"],
      },
    },
  });
  await t.checkText(summary(testsRule.check(clean3)) === "", "true");
});

// ## Finding: `source-roots` — an extra source root
void test("Finding: `source-roots` — an extra source root", async (t) => {
  // doctest:L65
  const extraRoot = layout({
    files: { "src/core/x.ts": {} },
    extraSourceRoots: ["scripts"],
  });
  const extraRootFindings = testsRule.check(extraRoot);
  await t.checkText(extraRootFindings.length, "1");

  // doctest:L73
  t.check(extraRootFindings[0]?.message, "second source root; fold it into pkg/src so tests have one tree to mirror");
});

// ## Finding: `test-placement` — a test outside the test root
void test("Finding: `test-placement` — a test outside the test root", async (t) => {
  // doctest:L80
  const outsideRoot = layout({
    files: {
      "src/core/x.ts": {},
      "core/loose.doctest.md": { test: [] },
    },
  });
  const outsideRootFindings = testsRule.check(outsideRoot);
  await t.checkText(outsideRootFindings.length, "1");

  // doctest:L90
  t.check(outsideRootFindings[0]?.message, "tests live under pkg/test, mirroring the source path");
});

// ## Finding: `test-naming` — a flattened prefix name
void test("Finding: `test-naming` — a flattened prefix name", async (t) => {
  // doctest:L97
  const flattened = layout({
    files: {
      "src/core/chat/session/archive.ts": {},
      "test/core/chat-session-archive.doctest.md": { test: ["src/core/chat/session/archive.ts"] },
    },
  });
  const flattenedFindings = testsRule.check(flattened);
  await t.checkText(flattenedFindings.length, "1");

  // doctest:L107
  t.check(flattenedFindings[0]?.rule, "test-naming");

  // doctest:L110
  t.check(flattenedFindings[0]?.message, "chat-session-archive.doctest.md names no module or directory in pkg/src/core; name it subject.facet.ext after the module or directory it tests");
});

// ## Finding: `test-structure` — the group's top directory has a source counterpart
//
// `test/core/misc` is not an exact mirror, and its top segment below `test`
// (`test/core`) mirrors `src/core`, which exists — so it is not a legitimate
// scenario group; the test belongs somewhere under the `core` mirror instead.
void test("test/core/misc is not an exact mirror, and its top segment below test (test/c...", async (t) => {
  // doctest:L121
  const misplacedGroup = layout({
    files: {
      "src/core/thing.ts": {},
      "test/core/misc/x.doctest.md": { test: [] },
    },
  });
  const misplacedGroupFindings = testsRule.check(misplacedGroup);
  await t.checkText(misplacedGroupFindings.length, "1");

  // doctest:L131
  t.check(misplacedGroupFindings[0]?.rule, "test-structure");

  // doctest:L134
  t.check(misplacedGroupFindings[0]?.message, "pkg/test/core/misc has no source counterpart; move this test to the mirror of the module it tests");
});

// ## Clean: a scenario group may import source modules
//
// `test/tours` has no source counterpart, so it is a scenario group. Its tests
// name a scenario, not a module, and import whatever they need for setup and
// assertions.
void test("test/tours has no source counterpart, so it is a scenario group.", async (t) => {
  // doctest:L145
  const scenarioTour = layout({
    files: {
      "src/core/x.ts": {},
      "test/tours/y.tour.ts": { test: ["src/core/x.ts"] },
    },
  });
  await t.checkText(testsRule.check(scenarioTour).length, "0");
});

// ## Finding: a non-mirror group named after a nested package
//
// `test/frontend` has no source counterpart (`src/frontend` is a nested
// package, excluded from this layout): a group named after a nested package
// or a second source root is not a scenario group, since it mirrors code
// that has, or will have, its own test tree. This is decided by the group's
// name alone, not by what the test inside it imports.
void test("test/frontend has no source counterpart (src/frontend is a nested package, ex...", async (t) => {
  // doctest:L164
  const nestedNonMirror = layout({
    files: {
      "test/frontend/lib/x.doctest.md": { test: ["src/frontend/src/lib/docling.ts"] },
    },
    nestedPackages: ["src/frontend"],
  });
  const nestedNonMirrorFindings = testsRule.check(nestedNonMirror);
  t.check(summary(nestedNonMirrorFindings), "test-structure pkg/test/frontend/lib/x.doctest.md");

  // doctest:L174
  t.check(nestedNonMirrorFindings[0]?.message, "pkg/test/frontend mirrors the nested package pkg/src/frontend; its tests belong in pkg/src/frontend/test");
});

void test("Finding: a non-mirror group named after a nested package", async (t) => {
  // doctest:L179
  const extraRootGroup = layout({
    files: {
      "scripts/migrate/file.ts": {},
      "test/scripts/migrate/file.doctest.md": { test: ["scripts/migrate/file.ts"] },
    },
    extraSourceRoots: ["scripts"],
  });
  await t.checkText(testsRule.check(extraRootGroup).map((f) => f.message).join("\n"), `second source root; fold it into pkg/src so tests have one tree to mirror
pkg/test/scripts mirrors the second source root pkg/scripts; fold that root into pkg/src and mirror it there`);
});

// ## Finding: `support-placement` — a helper placed above its only users
void test("Finding: `support-placement` — a helper placed above its only users", async (t) => {
  // doctest:L195
  const misplacedHelper = layout({
    files: {
      "src/core/agent/agent.ts": {},
      "test/core/helper.ts": {},
      "test/core/agent/agent.doctest.md": {
        test: ["src/core/agent/agent.ts", "test/core/helper.ts"],
      },
    },
  });
  const misplacedHelperFindings = testsRule.check(misplacedHelper);
  await t.checkText(misplacedHelperFindings.length, "1");

  // doctest:L208
  t.check(misplacedHelperFindings[0]?.rule, "support-placement");

  // doctest:L211
  t.check(misplacedHelperFindings[0]?.message, "used by tests under pkg/test/core/agent; move it to pkg/test/core/agent/ (or a support directory directly under it)");
});
