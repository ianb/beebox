// The pure half of bin/lint-changed.ts: which changed paths each eslint config
// owns, and which packages the root fan-out has anything to do for.
//
// A `.test.ts` rather than a doctest, matching its neighbours (test-select,
// finish-preflight) and because root `pnpm test` is what runs bin/ tooling
// tests. See bin/CLAUDE.md's note on the doctest-first rule.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { dispatchPlan, packageOf, splitCallbackBoxTargets } from "./lint-changed.js";
import { packageOwnerDirs } from "./workspace-packages.js";

// What `packageOwnerDirs` returns for this repo: workspace packages minus the
// frontend, which callback-box's own scripts cover.
const PACKAGE_DIRS = [
  "callback-box",
  "callback-box/pub-worker",
  "site",
  "personal-vibe-check",
];

test("frontend source goes to the frontend config, everything else to the root one", () => {
  const split = splitCallbackBoxTargets([
    "callback-box/src/core/box.ts",
    "callback-box/src/frontend/src/pages/ChatPage.tsx",
    "callback-box/test/core/box.doctest.md",
    "callback-box/scripts/build-cli.ts",
    "callback-box/user-stories/pipeline/run.ts",
  ]);
  assert.deepEqual(split.backend, [
    "scripts/build-cli.ts",
    "src/core/box.ts",
    "user-stories/pipeline/run.ts",
  ]);
  assert.deepEqual(split.frontend, ["src/pages/ChatPage.tsx"]);
});

test("paths no lint script covers are dropped rather than handed to eslint", () => {
  // deploy/ and docs/ are outside `eslint src/ scripts/ test/ user-stories/`;
  // `.mjs` is in the config's own ignores; another package is not ours at all.
  const split = splitCallbackBoxTargets([
    "callback-box/deploy/deploy.ts",
    "callback-box/docs/testing.md",
    "callback-box/src/webapp/thing.mjs",
    "callback-box/src/frontend/vite.config.ts",
    "site/src/index.ts",
  ]);
  assert.deepEqual(split, { backend: [], frontend: [] });
});

test("the workspace list expands globs, honours `!`, and skips scriptless packages", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-packages-"));
  const write = (dir: string, json: unknown): void => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(json));
  };
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n  - \"!apps/excluded\"\n",
  );
  write("apps/one", { name: "one", scripts: { lint: "eslint ." } });
  write("apps/scriptless", { name: "scriptless" });
  write("apps/excluded", { name: "excluded", scripts: { test: "tap" } });
  assert.deepEqual(packageOwnerDirs(root), ["apps/one"]);
  rmSync(root, { recursive: true, force: true });
});

test("the workspace list resolves nested packages and drops the frontend", () => {
  const dirs = packageOwnerDirs(join(import.meta.dirname, ".."));
  assert.ok(dirs.includes("callback-box/pub-worker"));
  // A package with no scripts of its own is not an owner: `browse` checks it.
  assert.ok(dirs.includes("browse"));
  assert.ok(!dirs.includes("browse/packages/agent-browser-typed"));
  assert.ok(!dirs.includes("callback-box/src/frontend"));
});

test("the frontend package is never its own lint run — callback-box covers it", () => {
  assert.equal(
    packageOf("callback-box/src/frontend/src/App.tsx", PACKAGE_DIRS),
    "callback-box",
  );
  // A genuinely nested package still wins by longest prefix.
  assert.equal(packageOf("callback-box/pub-worker/src/w.ts", PACKAGE_DIRS), "callback-box/pub-worker");
  assert.equal(packageOf("bin/router.ts", PACKAGE_DIRS), null);
});

test("the root fan-out reduces to the packages the change touched", () => {
  const plan = dispatchPlan({
    paths: ["callback-box/src/core/box.ts", "site/src/index.ts", "schedules/nightly/run.ts"],
    packageDirs: PACKAGE_DIRS,
    hasScript: (dir, script) => (dir === "callback-box" ? true : script === "lint"),
  });
  assert.deepEqual(
    plan.map((c) => c.label),
    ["pnpm --dir callback-box lint:changed", "pnpm --dir site lint", "bin/schedules lint"],
  );
});

test("a package with no lint script contributes nothing", () => {
  const plan = dispatchPlan({
    paths: ["personal-vibe-check/preset.ts"],
    packageDirs: PACKAGE_DIRS,
    hasScript: () => false,
  });
  assert.deepEqual(plan, []);
});
