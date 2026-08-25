import assert from "node:assert/strict";
import test from "node:test";

import callbackBox from "../callback-box/package.json" with { type: "json" };
import frontend from "../callback-box/src/frontend/package.json" with { type: "json" };
import root from "../package.json" with { type: "json" };

test("workspace lint excludes frontend only because callback-box lint covers it", () => {
  assert.equal(root.scripts.lint, "pnpm --filter '!callback-box-frontend' -r lint");
  assert.equal(
    callbackBox.scripts.lint,
    "node --import tsx ../bin/with-slot.ts -- pnpm run '/^lint:(backend|frontend)$/'",
  );
  assert.equal(
    callbackBox.scripts["lint:backend"],
    "eslint --cache --cache-location node_modules/.cache/eslint/backend src/ scripts/ test/ user-stories/",
  );
  assert.equal(callbackBox.scripts["lint:frontend"], "cd src/frontend && pnpm lint");
});

// bin/lint-changed.ts derives its file split from these roots. If a script here
// grows a directory, splitCallbackBoxTargets has to grow it too — otherwise
// `lint:changed` silently skips files the whole-tree run does check.
// See issues/code-quality/2026-08-25-lint-runs-contend-like-tests.md.
test("the changed-file lint covers exactly what the whole-tree scripts cover", () => {
  assert.match(callbackBox.scripts["lint:backend"], / src\/ scripts\/ test\/ user-stories\/$/);
  assert.match(frontend.scripts.lint, / src\/$/);
});
