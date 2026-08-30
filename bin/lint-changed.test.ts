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

import { dispatchPlan, packageOf, splitBeeBoxTargets } from "./lint-changed.js";
import { packageOwnerDirs } from "./workspace-packages.js";

// What `packageOwnerDirs` returns for this repo: workspace packages minus the
// frontend, which beebox's own scripts cover.
const PACKAGE_DIRS = [
  "beebox",
  "beebox/pub-worker",
  "site",
  "personal-vibe-check",
];

test("frontend source goes to the frontend config, everything else to the root one", () => {
  const split = splitBeeBoxTargets([
    "beebox/src/core/box.ts",
    "beebox/src/frontend/src/pages/ChatPage.tsx",
    "beebox/test/core/box.doctest.md",
    "beebox/scripts/build-cli.ts",
    "beebox/user-stories/pipeline/run.ts",
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
  const split = splitBeeBoxTargets([
    "beebox/deploy/deploy.ts",
    "beebox/docs/testing.md",
    "beebox/src/webapp/thing.mjs",
    "beebox/src/frontend/vite.config.ts",
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
  assert.ok(dirs.includes("beebox/pub-worker"));
  // A package with no scripts of its own is not an owner: `browse` checks it.
  assert.ok(dirs.includes("browse"));
  assert.ok(!dirs.includes("browse/packages/agent-browser-typed"));
  assert.ok(!dirs.includes("beebox/src/frontend"));
});

test("the frontend package is never its own lint run — beebox covers it", () => {
  assert.equal(
    packageOf("beebox/src/frontend/src/App.tsx", PACKAGE_DIRS),
    "beebox",
  );
  // A genuinely nested package still wins by longest prefix.
  assert.equal(packageOf("beebox/pub-worker/src/w.ts", PACKAGE_DIRS), "beebox/pub-worker");
  assert.equal(packageOf("bin/router.ts", PACKAGE_DIRS), null);
});

test("the root fan-out reduces to the packages the change touched", () => {
  const plan = dispatchPlan({
    paths: [
      "beebox/src/core/box.ts",
      "site/src/index.ts",
      "schedules/nightly/run.ts",
      "bin/router.ts",
    ],
    packageDirs: PACKAGE_DIRS,
    hasScript: (dir, script) => (dir === "beebox" ? true : script === "lint"),
  });
  assert.deepEqual(
    plan.map((c) => c.label),
    [
      "pnpm --dir beebox lint:changed",
      "pnpm --dir site lint",
      "bin/schedules lint",
      "pnpm lint:bin",
    ],
  );
});

test("bin/ is linted from the root, and only for the files eslint reads there", () => {
  const plan = (paths: string[]): string[] =>
    dispatchPlan({ paths, packageDirs: PACKAGE_DIRS, hasScript: () => true }).map((c) => c.label);
  assert.deepEqual(plan(["bin/lib/schedules-store.ts"]), ["pnpm lint:bin"]);
  assert.deepEqual(plan(["bin/router.test.ts"]), ["pnpm lint:bin"]);
  // `bin/land` and `bin/schedules` are shell; `bin/CLAUDE.md` is prose.
  assert.deepEqual(plan(["bin/land", "bin/CLAUDE.md"]), []);
});

test("a package with no lint script contributes nothing", () => {
  const plan = dispatchPlan({
    paths: ["personal-vibe-check/preset.ts"],
    packageDirs: PACKAGE_DIRS,
    hasScript: () => false,
  });
  assert.deepEqual(plan, []);
});
