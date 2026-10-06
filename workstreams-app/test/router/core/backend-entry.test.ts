// Unit tests for core/backend-entry.ts's current-path/pre-rename-path
// fallback, plus an expiry guard so the fallback does not outlive its
// purpose (see issues/deferred/2026-09-27-retire-router-pre-rename-backend-paths.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  BACKEND_ENTRY_CANDIDATES,
  BackendEntryMissingError,
  resolveBackendEntryPath,
} from "../../../src/router/core/backend-entry.js";

const CHECKOUT = "/checkouts/some-worktree/beebox";

function existsOnly(...present: string[]): (p: string) => Promise<boolean> {
  const set = new Set(present.map((p) => path.join(CHECKOUT, p)));
  return (p) => Promise.resolve(set.has(p));
}

test("resolveBackendEntryPath: current-layout generation resolves the current path, no warning", async () => {
  const warnings: string[] = [];
  const resolved = await resolveBackendEntryPath({
    pathExists: existsOnly("./src/cli/entry/run.ts"),
    warn: (msg) => warnings.push(msg),
    checkoutBackendCwd: CHECKOUT,
    key: "hubEntry",
  });
  assert.equal(resolved, "./src/cli/entry/run.ts");
  assert.deepEqual(warnings, []);
});

test("resolveBackendEntryPath: pre-rename generation falls back and warns once, naming checkout and old path", async () => {
  const warnings: string[] = [];
  const resolved = await resolveBackendEntryPath({
    pathExists: existsOnly("./src/cli/index.ts"),
    warn: (msg) => warnings.push(msg),
    checkoutBackendCwd: CHECKOUT,
    key: "hubEntry",
  });
  assert.equal(resolved, "./src/cli/index.ts");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]!.includes(CHECKOUT));
  assert.match(warnings[0]!, /src\/cli\/index\.ts/);
});

test("resolveBackendEntryPath: neither generation present throws, naming both candidates and the checkout", async () => {
  await assert.rejects(
    () => resolveBackendEntryPath({ pathExists: existsOnly(), warn: () => {}, checkoutBackendCwd: CHECKOUT, key: "hubEntry" }),
    (err: unknown) => {
      assert.ok(err instanceof BackendEntryMissingError);
      assert.equal(err.checkoutBackendCwd, CHECKOUT);
      assert.equal(err.key, "hubEntry");
      assert.match(err.message, /src\/cli\/entry\/run\.ts/);
      assert.match(err.message, /src\/cli\/index\.ts/);
      assert.ok(err.message.includes(CHECKOUT));
      return true;
    },
  );
});

test("resolveBackendEntryPath: a single-candidate entry (unmoved path) resolves without warning", async () => {
  const warnings: string[] = [];
  const resolved = await resolveBackendEntryPath({
    pathExists: existsOnly("./tsx-preload.mjs"),
    warn: (msg) => warnings.push(msg),
    checkoutBackendCwd: CHECKOUT,
    key: "tsxPreload",
  });
  assert.equal(resolved, "./tsx-preload.mjs");
  assert.deepEqual(warnings, []);
});

// Expiry guard: the pre-rename fallback is a deliberately temporary bridge
// while worktree branches created before the 2026-09-27 layout moves
// (commit 3b5d64ca0) are still alive. Uses the REAL clock (Date.now, not a
// frozen test clock) so this fires from the hourly full suite on `main` on
// its own, without anyone reading the deferred issue on its activation date.
test("pre-rename backend-entry fallbacks must be retired after 2026-11-15", () => {
  const expiry = Date.parse("2026-11-15T00:00:00Z");
  const stillHasOldPaths = Object.values(BACKEND_ENTRY_CANDIDATES).some((candidates) => candidates.length > 1);
  if (Date.now() >= expiry && stillHasOldPaths) {
    assert.fail(
      "The pre-rename fallback paths in workstreams-app/src/router/core/backend-entry.ts " +
        "(BACKEND_ENTRY_CANDIDATES) are past their 2026-11-15 expiry. Run: " +
        "for b in $(git branch --list 'worktree-*'); do git merge-base --is-ancestor 3b5d64ca0 $b || echo $b; done — " +
        "if that prints nothing, every worktree branch has the current layout: merge or retire any stragglers, " +
        "then delete the old-path (second) entries in BACKEND_ENTRY_CANDIDATES and this test. See " +
        "issues/deferred/2026-09-27-retire-router-pre-rename-backend-paths.md.",
    );
  }
});
