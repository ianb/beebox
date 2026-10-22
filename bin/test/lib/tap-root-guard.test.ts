// # Running tap from the monorepo root
//
// The root `.taprc` preloads `bin/tap-root-guard.ts` into every test process tap
// starts from the monorepo root. The root has none of the loaders a package's
// tests need, so instead of a bare failure the process reports which package owns
// the test and the command that runs it there.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { rootGuardReport } from "../../lib/tap-root-guard.ts";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");

// A test in `beebox` names `beebox` and its path inside the package:
void test("A test in beebox names beebox and its path inside the package:", async (t) => {
  await t.checkText(rootGuardReport({ testFile: `${repoRoot}/beebox/test/lib/cookies.test.ts`, repoRoot }), `TAP version 14
1..1
not ok 1 - run this test from its package: cd beebox && pnpm exec tap test/lib/cookies.test.ts`);
});

// A file outside any package with a `.taprc` gets the general instruction:
void test("A file outside any package with a .taprc gets the general instruction:", async (t) => {
  await t.checkText(rootGuardReport({ testFile: `${repoRoot}/scratch/x.test.ts`, repoRoot }), `TAP version 14
1..1
not ok 1 - tap is not configured at the monorepo root; run tests from the package that owns them`);
});
