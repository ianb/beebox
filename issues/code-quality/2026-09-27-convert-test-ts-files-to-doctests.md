---
title: "Convert most *.test.ts files to doctests"
workstream: unattached
area: beebox
labels: [testing, doctest]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
---

Doctests are this repository's default test form (`beebox/CLAUDE.md`), and
they hold about 87% of test lines. The monorepo still has 132 `*.test.ts`
and `*.test.tsx` files, about 18,000 non-blank lines (count on 2026-09-27).
The developer wants most of them converted to doctests, so that tests are
written, read, and run one way.

## Where they are

| Package | Files | Runner today |
|---|---:|---|
| `bin/` | 38 | `node --test` (root `package.json`, with `schedules/*/*.test.ts`) |
| `workstreams-app/` | 21 | mixed; the package also runs doctests |
| `site/` | 20 | `node --test` |
| `canvas-loop/` | 17 | `node --test` |
| `beebox-clerk/` | 12 | `tap` |
| `schedules/` | 10 | `node --test`, through the root script |
| `beebox/` | 10 | `tap`, except `pub-worker/test/` (5), which runs on vitest with the Cloudflare Workers pool; includes one frontend test |
| others | 4 | `agent-doctest/` (2), `personal-vibe-check/`, `feedback-review/` |

## What to decide per package

- **Whether it can run doctests.** A package on `node --test` has no
  doctest runner yet. Adding one is a change to that package's `test` script
  and its dependencies.
- **Which files should stay code.** Keep a `*.test.ts` file where a doctest
  would be worse. Possible cases: tests of the doctest framework itself in
  `agent-doctest/`, tests that run inside another runtime (the Cloudflare
  worker in `beebox/pub-worker/`), and heavy harness tests. Record why each
  one stays.
- **Order.** Convert one package at a time, and keep its test count and
  coverage the same across the conversion.

Do the [doctest usability review](../closed/exploration/2026-09-27-doctest-usability-review.md)
first or alongside. Its findings may change how the converted tests should
be written.

## Fit, from the usability review

The [doctest usability review](../../beebox/docs/plans/doctest-usability.md)
sorted every `*.test.ts` file by test shape (2026-09-28) and ran test-writing
subjects on conversions. It found:

- **About 69 files convert easily.** These are pure input-to-output tests,
  including large tables (`workstreams-app/test/router/server/auth.classify.test.ts`,
  `bin/test-tiers.test.ts`), plus run transcripts and simple temp-directory
  fixtures. Subjects converted `auth.classify` (about 60 cases, one example per
  case) without trouble.
- **About 44 convert with effort.** These have long fixtures, temp repositories,
  spawned CLIs, or fake collaborators. Move the shared helpers into a module
  next to the tests first, so that each doctest opens with prose rather than a
  long setup block.
- **20 files should stay code**, listed below.

Convert after the doctest changes from that review (on `main` since
2026-09-29), not before. A doctest can now compare an object with a literal
(`=> { kind: "box" }`, in any key order). Before that change, conversions
wrapped every result in `JSON.stringify`, which produced one-line blobs that
read badly and diff badly.

### Files that stay code

| File | Why |
|---|---|
| `agent-doctest/test/doctest-hooks.test.ts`, `doctest-hooks.load.test.ts`, `tap-check/check.test.ts` | Tests of the doctest framework itself. They write fixtures that contain fences and observe tests that fail on purpose; as doctests they would test the runner with the runner. |
| `beebox/pub-worker/test/access.test.ts`, `shared-site.test.ts`, `site.test.ts`, `submit.test.ts`, `worker.test.ts` | Run inside the Cloudflare Workers runtime (vitest pool, `cloudflare:test`, a Miniflare R2 binding). The doctest loader runs in Node only. |
| `beebox/src/frontend/test/lib/trpc/client.directory-resolution.test.ts` | Reproduces a module-loader race by spawning 12 concurrent loader children; the test is about the loader the doctest runner also uses. |
| `bin/deploy-lock.test.ts`, `bin/test-locks.test.ts`, `bin/schedules-hardening.test.ts`, `bin/scheduled-workstreams-registry.test.ts` | Concurrency tests with real lock-holding processes, bash harnesses, polling for files, and timeouts. Most of each file is the harness. |
| `workstreams-app/test/router/core.test.ts`, `core.retry.test.ts`, `core.startup-death.test.ts` | Built on `core-harness.ts` (a fake clock, fake child processes, `ticks()`); the assertions are about event order under a simulated clock. |
| `workstreams-app/test/router/core.teardown.test.ts`, `workstreams-app/test/scenarios/workstreams-app-retry.test.ts` | Real listeners and spawned children with timers; the subject is process lifetime. |
| `personal-vibe-check/rules/test/restrict-component-classes.test.ts`, `canvas-loop/test/eslint/plugin.test.ts` | ESLint `RuleTester` suites: arrays of valid and invalid cases that the RuleTester itself asserts. |

The harness-heavy files in the last four rows could become doctests later if
the harness moves to a module and each doctest becomes a short scenario over
it. That is a separate decision; do not convert them as written.

