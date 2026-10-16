# Which package typechecks a staged doctest

The pre-commit hook typechecks each staged `.doctest.md` through the package
that owns it, so the package's own `typecheck:doctest` groups pick the
tsconfig. The owner is the nearest directory whose package.json has that
script.

```ts setup
import { ownerOf } from "../doctest-typecheck-staged.js";

/** Packages with a typecheck:doctest script, by repo-relative directory. */
const withScript = new Set(["beebox", "workstreams-app"]);
const owner = (file: string) => ownerOf(file, (dir) => withScript.has(dir));
```

A doctest belongs to the nearest package with the script, however deep it
sits.

```ts
[owner("beebox/test/core/box.doctest.md"), owner("beebox/src/frontend/test/ui/toast.doctest.md"), owner("workstreams-app/test/server/app.doctest.md")]
=> ["beebox","beebox","workstreams-app"]
```

`bin/test/` has no package of its own. beebox's tap config runs those
doctests, and its script checks them under the root tsconfig.

```ts
owner("bin/test/smoke-lib.doctest.md")
=> beebox
```

A doctest under no package with the script has no owner, and the hook fails
the commit instead of leaving it unchecked.

```ts
owner("canvas-loop/test/sketch.doctest.md")
=> null
```
