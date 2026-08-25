import assert from "node:assert/strict";
import test from "node:test";

import callbackBox from "../callback-box/package.json" with { type: "json" };
import root from "../package.json" with { type: "json" };

test("workspace lint excludes frontend only because callback-box lint covers it", () => {
  assert.equal(root.scripts.lint, "pnpm --filter '!callback-box-frontend' -r lint");
  assert.equal(callbackBox.scripts.lint, "pnpm run '/^lint:(backend|frontend)$/'");
  assert.equal(callbackBox.scripts["lint:backend"], "eslint src/ scripts/ test/ user-stories/");
  assert.equal(callbackBox.scripts["lint:frontend"], "cd src/frontend && pnpm lint");
});
