/** The full-suite alert texts: what a reader concludes from the first line. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BISECT_MAX_FILES } from "./lib.js";
import { flakesAlertTitle, redAlertTitle, renderEnvironmentAlert, renderRedAlert } from "./alerts.js";

const landing = { commit: "abcdef1234567890".padEnd(40, "0"), subject: "Merge branch 'worktree-scanner-ingest'" };

test("the red alert names culprits, flakes and what it did not bisect", () => {
  const message = renderRedAlert({
    testedCommit: "1".repeat(40),
    baseCommit: "2".repeat(40),
    landings: [landing],
    culprits: [{ landing, files: ["test/a.test.ts"], excerpt: "" }],
    flakes: ["test/hub/hub-e2e.doctest.md"],
    unattributed: ["test/b.test.ts"],
  });
  assert.match(message, /^\*\*2 test files fail on main\*\*, bisected to 1 landing\./u);
  assert.match(message, /`abcdef12` \(scanner-ingest\): `test\/a\.test\.ts`/u);
  assert.match(message, /hub-e2e/u);
  assert.ok(message.includes(`${String(BISECT_MAX_FILES)}-file budget`), message);
});

test("a flakes-only red alert leads with 'nothing is broken', not with 'red'", () => {
  const message = renderRedAlert({
    testedCommit: "1".repeat(40),
    baseCommit: "2".repeat(40),
    landings: [landing, landing],
    culprits: [],
    flakes: ["test/dev/auto-sweep-detach.doctest.md"],
    unattributed: [],
  });
  assert.match(message, /^\*\*Nothing is broken\.\*\* 1 test file failed in the batched run and passed/u);
  assert.match(message, /- \*\*Tested:\*\* main at `11111111` \(2 landings since `22222222`\)/u);
  assert.match(message, /- \*\*Flaky\*\* \(failed in the batch, passed on re-run; in the flake ledger, no issue\): `test\/dev\/auto-sweep-detach\.doctest\.md`/u);
  assert.doesNotMatch(message, /red/iu);
});

test("the environment alert says why nothing was filed", () => {
  const message = renderEnvironmentAlert({
    testedCommit: "1".repeat(40),
    failures: Array.from({ length: 40 }, (_unused, i) => `test/f${String(i)}.test.ts`),
  });
  assert.match(message, /40 test files failed/u);
  assert.match(message, /no\nissue was filed/u);
});

test("one failing file reads as singular", () => {
  const message = renderRedAlert({
    testedCommit: "1".repeat(40),
    baseCommit: "2".repeat(40),
    landings: [landing],
    culprits: [],
    flakes: [],
    unattributed: ["test/a.test.ts"],
    unattributedReason: "already red at baseline",
  });
  assert.match(message, /^\*\*1 test file fails on main\*\*, not attributable to a landing\./u);
});

test("titles count what failed, not the colour of the run", () => {
  assert.equal(flakesAlertTitle(["test/a.test.ts"]), "full suite green after re-run: 1 flaky file");
  assert.equal(
    redAlertTitle({ real: ["test/a.test.ts", "test/b.test.ts"], culprits: [] }),
    "full suite: 2 files failing, no attributable landing",
  );
  assert.equal(
    redAlertTitle({ real: ["test/a.test.ts"], culprits: [{ landing, files: ["test/a.test.ts"], excerpt: "" }] }),
    "full suite: 1 file failing, blamed on 1 landing",
  );
});
