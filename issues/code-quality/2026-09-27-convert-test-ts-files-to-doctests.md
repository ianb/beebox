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
| `beebox/` | 10 | `tap`; includes `pub-worker/test/` (5) and one frontend test |
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

Do the [doctest usability review](../exploration/2026-09-27-doctest-usability-review.md)
first or alongside. Its findings may change how the converted tests should
be written.
