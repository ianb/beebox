# Test placement (rule 8)

`testsRule` enforces one source root with a test root that mirrors it
directory-for-directory (`docs/plans/file-layout.md` rule 8). A test is
placed by the subject it NAMES, not by what it imports for setup.
`summary()` only prints `rule path`, so most checks here read `.message`
directly to pin the exact wording a boxholder sees.

```ts setup
import { testsRule } from "../../../../../src/dev/layout/check/rules/tests.js";
import { layout, summary } from "./fixture.js";
```

## Clean: a single module named by two facets

```ts
const clean1 = layout({
  files: {
    "src/core/chat/session/history.ts": {},
    "test/core/chat/session/history.doctest.md": { test: ["src/core/chat/session/history.ts"] },
    "test/core/chat/session/history.archive.doctest.md": { test: ["src/core/chat/session/history.ts"] },
  },
});
summary(testsRule.check(clean1)) === ""
=> true
```

## Clean: a test named for a subdirectory, not a module

```ts
const clean2 = layout({
  files: {
    "src/core/chat/session/history.ts": {},
    "test/core/chat/session.lifecycle.doctest.md": { test: [] },
  },
});
summary(testsRule.check(clean2)) === ""
=> true
```

## Clean: a named test importing collaborators from elsewhere and a type

Naming no longer counts imports: `agent.doctest.md` names `agent.ts` in its
own mirror, so importing a value from another area and a type from `shared`
is unrelated to placement.

```ts
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
summary(testsRule.check(clean3)) === ""
=> true
```

## Clean: a type-only import into a nested package

```ts
const clean4 = layout({
  files: {
    "src/core/agent/agent.ts": {},
    "test/core/agent/agent.doctest.md": { test: ["src/core/agent/agent.ts"] },
  },
  nestedPackages: ["src/frontend"],
});
const clean4Test = clean4.files.get("pkg/test/core/agent/agent.doctest.md");
if (clean4Test === undefined || clean4Test.kind !== "test") throw new Error("expected test file");
clean4Test.imports.push({
  specifier: "../../../frontend/src/lib/x.js",
  target: "pkg/src/frontend/src/lib/x.ts",
  external: false,
  typeOnly: true,
  names: [],
  dynamic: false,
});
summary(testsRule.check(clean4)) === ""
=> true
```

## Clean: a scenario test importing nothing from source

```ts
const clean5 = layout({
  files: {
    "src/core/x.ts": {},
    "test/tours/x.tour.ts": { test: [] },
  },
});
summary(testsRule.check(clean5)) === ""
=> true
```

## Finding: `source-roots` — an extra source root

```ts
const extraRoot = layout({
  files: { "src/core/x.ts": {} },
  extraSourceRoots: ["scripts"],
});
const extraRootFindings = testsRule.check(extraRoot);
extraRootFindings.length
=> 1

extraRootFindings[0].message
=> second source root; fold it into pkg/src so tests have one tree to mirror
```

## Finding: `test-placement` — a test outside the test root

```ts
const outsideRoot = layout({
  files: {
    "src/core/x.ts": {},
    "core/loose.doctest.md": { test: [] },
  },
});
const outsideRootFindings = testsRule.check(outsideRoot);
outsideRootFindings.length
=> 1

outsideRootFindings[0].message
=> tests live under pkg/test, mirroring the source path
```

## Finding: `test-placement` — a test importing a nested package's code

```ts
const nested = layout({
  files: {
    "src/core/x.ts": {},
    "src/frontend/src/lib/docling.ts": {},
    "test/core/x.doctest.md": { test: ["src/frontend/src/lib/docling.ts"] },
  },
  nestedPackages: ["src/frontend"],
});
const nestedFindings = testsRule.check(nested);
nestedFindings.length
=> 1

nestedFindings[0].message
=> tests pkg/src/frontend code; it belongs in pkg/src/frontend/test
```

## Finding: `test-placement` — a test importing code outside the package

The fixture can only address paths under `pkg/`, so this builds a layout and
then edits the returned model directly to give the test an import target
(`bin/foo.ts`) outside the package root entirely, without adding the outside
file to `files`. As in a real scan, the rule classifies it by path.

```ts
const outsidePkg = layout({
  files: {
    "src/core/x.ts": {},
    "test/core/x.doctest.md": { test: [] },
  },
});
const outsideTest = outsidePkg.files.get("pkg/test/core/x.doctest.md");
if (outsideTest === undefined || outsideTest.kind !== "test") throw new Error("expected test file");
outsideTest.imports = [
  { specifier: "../../../bin/foo.js", target: "bin/foo.ts", external: false, typeOnly: false, names: [], dynamic: false },
];
const outsidePkgFindings = testsRule.check(outsidePkg);
outsidePkgFindings.length
=> 1

outsidePkgFindings[0].message
=> tests bin/foo.ts, which is outside this package; it belongs in that package's test root
```

## Finding: `test-naming` — a flattened prefix name

```ts
const flattened = layout({
  files: {
    "src/core/chat/session/archive.ts": {},
    "test/core/chat-session-archive.doctest.md": { test: ["src/core/chat/session/archive.ts"] },
  },
});
const flattenedFindings = testsRule.check(flattened);
flattenedFindings.length
=> 1

flattenedFindings[0].rule
=> test-naming

flattenedFindings[0].message
=> chat-session-archive.doctest.md names no module or directory in pkg/src/core; name it subject.facet.ext after the module or directory it tests
```

## Finding: `test-structure` — the group's top directory has a source counterpart

`test/core/misc` is not an exact mirror, and its top segment below `test`
(`test/core`) mirrors `src/core`, which exists — so it is not a legitimate
scenario group; the test belongs somewhere under the `core` mirror instead.

```ts
const misplacedGroup = layout({
  files: {
    "src/core/thing.ts": {},
    "test/core/misc/x.doctest.md": { test: [] },
  },
});
const misplacedGroupFindings = testsRule.check(misplacedGroup);
misplacedGroupFindings.length
=> 1

misplacedGroupFindings[0].rule
=> test-structure

misplacedGroupFindings[0].message
=> pkg/test/core/misc has no source counterpart; move this test to the mirror of the module it tests
```

## Clean: a scenario group may import source modules

`test/tours` has no source counterpart, so it is a scenario group. Its tests
name a scenario, not a module, and import whatever they need for setup and
assertions.

```ts
const scenarioTour = layout({
  files: {
    "src/core/x.ts": {},
    "test/tours/y.tour.ts": { test: ["src/core/x.ts"] },
  },
});
testsRule.check(scenarioTour).length
=> 0
```

## Findings: nested-package import from a non-mirror directory with no source counterpart

`test/frontend` has no source counterpart (`src/frontend` is a nested
package, excluded from this layout), so structurally it is a scenario group.
The test's value import reaches into the nested package, so it belongs in
that package's own test root.

```ts
const nestedNonMirror = layout({
  files: {
    "test/frontend/lib/x.doctest.md": { test: ["src/frontend/src/lib/docling.ts"] },
  },
  nestedPackages: ["src/frontend"],
});
const nestedNonMirrorFindings = testsRule.check(nestedNonMirror);
summary(nestedNonMirrorFindings)
=>
test-placement pkg/test/frontend/lib/x.doctest.md
test-structure pkg/test/frontend/lib/x.doctest.md
```

A group named after a nested package or a second source root is not a
scenario group: it mirrors code that has, or will have, its own test tree.

```ts continue
nestedNonMirrorFindings.map((f) => f.message).join("\n")
=>
pkg/test/frontend mirrors the nested package pkg/src/frontend; its tests belong in pkg/src/frontend/test
tests pkg/src/frontend code; it belongs in pkg/src/frontend/test

const extraRootGroup = layout({
  files: {
    "scripts/migrate/file.ts": {},
    "test/scripts/migrate/file.doctest.md": { test: ["scripts/migrate/file.ts"] },
  },
  extraSourceRoots: ["scripts"],
});
testsRule.check(extraRootGroup).map((f) => f.message).join("\n")
=>
second source root; fold it into pkg/src so tests have one tree to mirror
pkg/test/scripts mirrors the second source root pkg/scripts; fold that root into pkg/src and mirror it there
```

## Finding: `support-placement` — a helper placed above its only users

```ts
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
misplacedHelperFindings.length
=> 1

misplacedHelperFindings[0].rule
=> support-placement

misplacedHelperFindings[0].message
=> used by tests under pkg/test/core/agent; move it to pkg/test/core/agent/ (or a support directory directly under it)
```
