# Running tap from the monorepo root

The root `.taprc` preloads `bin/tap-root-guard.ts` into every test process tap
starts from the monorepo root. The root has none of the loaders a package's
tests need, so instead of a bare failure the process reports which package owns
the test and the command that runs it there.

```ts setup
import { rootGuardReport } from "../../lib/tap-root-guard.ts";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
```

A doctest in `beebox` names `beebox` and its path inside the package:

```ts
rootGuardReport({ testFile: `${repoRoot}/beebox/test/lib/cookies.doctest.md`, repoRoot })
=> TAP version 14
1..1
not ok 1 - run this test from its package: cd beebox && pnpm exec tap test/lib/cookies.doctest.md
```

A file outside any package with a `.taprc` gets the general instruction:

```ts
rootGuardReport({ testFile: `${repoRoot}/scratch/x.doctest.md`, repoRoot })
=> TAP version 14
1..1
not ok 1 - tap is not configured at the monorepo root; run tests from the package that owns them
```
