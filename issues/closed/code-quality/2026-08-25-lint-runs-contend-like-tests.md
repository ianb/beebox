---
title: "Concurrent lint/typecheck runs thrash the machine the same way tests did"
workstream: unattached
area: monorepo
labels: [developer-experience, tooling]
resolution: implemented
---

Observed 2026-08-25 while two agents worked one worktree: six concurrent
`callback-box` eslint runs (agents re-running `pnpm lint` after each edit)
plus two in a sibling worktree, each at 29–51 min elapsed against a solo
time of about a minute. Same pathology the test-run semaphore
(`bin/test-locks.ts`, plan `change-based-test-selection.md` mechanism A)
was built for; lint and typecheck have no such lock.

Options: put `pnpm lint` / `pnpm typecheck` behind the same machine-wide
semaphore (the lock is generic — tier "ordinary"); or teach agents to lint
only changed files (`eslint <paths>`) during iteration, which is the same
"run what the change implicates" move as `test:changed`. Both may be right.

**Closed 2026-08-25** — both options landed, plus two caching wins that turned
out to matter more than either. Measured solo on this machine, one at a time;
whole-tree eslint numbers drift ±30% run to run, so treat them as ranges.

| what | before | after |
| --- | ---: | ---: |
| `lint:backend`, cold cache | 32–43 s | 42 s (unchanged) |
| `lint:backend`, warm cache, no edit | 32–43 s | 4.4 s |
| `lint:backend`, warm cache, one edited file | 32–43 s | 5.4 s |
| `lint:frontend`, cold cache | 20–32 s | 32 s (unchanged) |
| `lint:frontend`, warm cache | 20–32 s | 3.2 s |
| `pnpm lint:changed`, two files (one backend, one frontend) | — | 6.2 s |
| `pnpm typecheck` (4 programs in parallel), cold | 8–12 s | 11 s (unchanged) |
| `pnpm typecheck`, warm | 8–12 s | 2.8 s |
| `pnpm typecheck`, after one edited file | 8–12 s | 4.7 s |
| `bin/with-slot.ts` around a no-op command | — | 0.13 s |

Kept:

- **`pnpm lint:changed`** (`bin/lint-changed.ts`) in callback-box and at the
  root. Changed = `git diff --name-only main...HEAD` ∪ dirty, through the test
  selector's own `changedPaths`, split by the boundary lint-staged uses. The
  root form dispatches per changed package (`callback-box` → its `lint:changed`,
  others → their `lint`, `schedules/` → `bin/schedules lint`).
- **ESLint `--cache`** on `lint:backend` and `lint:frontend`, in
  `node_modules/.cache/eslint/` (gitignored, per worktree). Cold cost is
  noise-level identical; warm is 7–10×.
- **`tsc --incremental`** with a `tsBuildInfoFile` under `node_modules/.cache/tsc/`
  on all four typecheck programs. Verified a deliberate type error still fails
  `pnpm typecheck` (exit 1, the error named).
- **`bin/with-slot.ts`** — the generic semaphore wrapper, on callback-box's
  whole-tree `lint` and `typecheck`. Pre-commit's `pnpm typecheck` is wrapped by
  virtue of being that script; its lint-staged run is not (it is small, and
  queueing it behind a whole-tree run would cost more than the contention does).

A cross-model review moved three things: `.jsx` joined the extension lists
(the preset's own glob is `{ts,tsx,js,jsx}`, so a `.jsx` file would have failed
`pnpm lint` and been skipped by `lint:changed`); the eslint runs ask for
`--cache-strategy content`, because the default strategy is mtime+size and the
correctness claim here is content-keyed (measured free — warm stays 1.6-3.4 s);
and `finish-preflight`'s lint entry collapsed to a single root `pnpm
lint:changed`, which is the fan-out and so also covers a `schedules/`-only
change that no per-package lint reaches. It also found that `groupOf` attributes
a nested workspace package's paths to its parent — filed separately as
[nested workspace packages](../../code-quality/2026-08-25-nested-workspace-packages-misclassified.md),
since it predates this work.

The cross-file escape is accepted and stated, the same posture the plan takes
for unimplicated tests: an eslint cache entry keys on one file's content, and
`lint:changed` looks only at changed files, so a type-aware rule's consequence
in a file that merely *imports* the change is missed. `pnpm lint` stays the
whole-tree gate.

With a warm cache, whole-tree `pnpm lint` (~4.4 s, both halves in parallel) and
`lint:changed` on two files (~6.2 s, two eslint startups) cost about the same.
The separation shows up on a cold or merge-invalidated cache, where the whole
tree is 40 s and the diff is 6 s. The 29–51 minute runs this issue was filed
about are the semaphore's to fix, not the cache's.
