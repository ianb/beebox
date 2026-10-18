// # Health check: `git-writable` is shape-aware
//
// `runHealthChecks`'s `git-writable` check probes the git repository, which
// under the one-root layout (shapeVersion 3) lives at the box root itself —
// so the check must resolve the box shape and probe `boxRoot/.git/objects`.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { runHealthChecks } from "../../../../../../src/webapp/trpc/routers/health/router.js";
import { failedWritability } from "../../../../../../src/webapp/trpc/routers/health/checks/writability.js";
import { createFakeClaudeCli } from "../../../../../../src/services/claude-cli.js";
import type { HealthCheck } from "../../../../../../src/shared/health-check.js";
import { makeTmpBox } from "../../../../../helpers/test-helpers.js";

const gitWritableCheck = (checks: HealthCheck[]) => checks.find((c: HealthCheck) => c.name === "git-writable");
// Inject a fake so the claude-auth check never shells out to real `claude`.
const claudeCli = createFakeClaudeCli({ loggedIn: true });

// ## No `.git/objects` at the box root fails
void test("No `.git/objects` at the box root fails", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L24
  const box = await makeTmpBox({ git: "none" });
  const checks = await runHealthChecks(box.root, { claudeCli });
  t.check(gitWritableCheck(checks), {
    name: "git-writable",
    ok: false,
    message: str`.git/objects is missing — commits will fail; verify the Git repository at ${any(String)}`,
    severity: "error",
  });
});

// ## A failed probe does not guess at ownership
//
// Missing paths are distinguishable from other failures, but an execution
// sandbox and filesystem permissions can both reject the probe. The health check
// reports that ambiguity instead of prescribing a destructive ownership change
// it cannot justify.
void test("Missing paths are distinguishable from other failures, but an execution sandb...", async (t) => {
  // doctest:L42
  t.check(
    [
      failedWritability(Object.assign(new Error("missing"), { code: "ENOENT" })),
      failedWritability(Object.assign(new Error("denied"), { code: "EACCES" })),
      failedWritability(Object.assign(new Error("sandboxed"), { code: "EPERM" })),
    ],
    [
    "missing",
    "not-writable",
    "not-writable",
  ],
  );
});

// ## `.git/objects` present at the box root passes
void test("`.git/objects` present at the box root passes", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L53
  const box = await makeTmpBox();
  await fs.mkdir(join(box.root, ".git/objects"), { recursive: true });
  const checks = await runHealthChecks(box.root, { claudeCli });
  t.check(gitWritableCheck(checks), {
    name: "git-writable",
    ok: true,
    message: ".git/objects is writable",
    severity: "error",
  });
});
