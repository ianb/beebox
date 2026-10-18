// # Which package typechecks a staged doctest
//
// The pre-commit hook typechecks each staged `.doctest.md` through the package
// that owns it, so the package's own `typecheck:doctest` groups pick the
// tsconfig. The owner is the nearest directory whose package.json has that
// script.

import { test } from "tap";
import "agent-doctest/tap";
import { ownerOf } from "../doctest-typecheck-staged.js";

/** Packages with a typecheck:doctest script, by repo-relative directory. */
const withScript = new Set(["beebox", "workstreams-app"]);
const owner = (file: string) => ownerOf(file, (dir) => withScript.has(dir));

// A doctest belongs to the nearest package with the script, however deep it
// sits.
void test("A doctest belongs to the nearest package with the script, however deep it sits.", async (t) => {
  // doctest:L20
  t.check([owner("beebox/test/core/box.doctest.md"), owner("beebox/src/frontend/test/ui/toast.doctest.md"), owner("workstreams-app/test/server/app.doctest.md")], [
    "beebox",
    "beebox",
    "workstreams-app",
  ]);
});

// `bin/test/` has no package of its own. beebox's tap config runs those
// doctests, and its script checks them under the root tsconfig.
void test("bin/test/ has no package of its own.", async (t) => {
  // doctest:L28
  t.check(owner("bin/test/smoke-lib.doctest.md"), "beebox");
});

// A doctest under no package with the script has no owner, and the hook fails
// the commit instead of leaving it unchecked.
void test("A doctest under no package with the script has no owner, and the hook fails t...", async (t) => {
  // doctest:L36
  t.check(owner("canvas-loop/test/sketch.doctest.md"), null);
});
