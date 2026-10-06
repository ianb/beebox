---
title: "Test selection and full-suite attribution cannot see `bin/` shell scripts"
workstream: test-suite-health
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — while explaining why test/dev/workstream-list.doctest.md went red for five full-suite runs
priority: normal
resolution: implemented
---

**Closed 2026-10-06:** fixed by commit 01f482e9d, with the boxholder's directory-based rule instead of a shell `source` graph. A `bin/<name>` spawn literal is a ref whose unit is the first segment under `bin/`; a changed `bin/` path selects every spawner of the same unit; `bin/lib` selects every `bin/` spawner. Root doctests (`bin/test/**`) are graph entrypoints through `beebox/.taprc`, so they are covered, and full-suite attribution uses the same `selectTests`. Evidence: `node --import tsx --test bin/test-select-bin.test.ts bin/test-select.test.ts schedules/full-suite/attribution.test.ts` passed (the issue's case, `bin/lib` fan-out, an unrelated script selecting nothing, src/dist unchanged). On the real tree with a working graph, 28 tests spawn a `bin/` script (22 under `bin/test/`), so a `bin/lib/session-registry.sh` change selects 28 and `bin/workstreams` selects 6 including `bin/test/workstreams.list.doctest.md`. The real selection CLI currently fails open to all tests for a separate reason: [the test graph build fails on three doctests](../../bugs/2026-10-06-test-graph-build-fails-on-three-doctests.md). Root `bin/*.test.ts` and `schedules/*/*.test.ts` run under `node --test` with no selection at all.

A change to a `bin/` shell script selects no tests and can be blamed for no
failure. 52 test files under `beebox/test/` spawn a `bin/` script, and every one
of those edges is invisible.

`spawnedSourceRefs` in `bin/test-select-lib.ts:114` finds a spawned path with
`SOURCE_LITERAL` (`bin/test-select-lib.ts:96`), which matches only
`src/**.{ts,tsx,mjs,js,jsx}` and `dist/cli.mjs`. `bin/workstreams` is
extensionless and outside `src/`, so it matches nothing:

```
spawnedSourceRefs(read("bin/test/workstreams.list.doctest.md")) === []
```

Two consequences, both observed on 2026-09-14:

- `pnpm test:changed` does not run the affected test, so the break lands.
- `schedules/full-suite` bisects through the same graph, so it reports the file
  as "already red at baseline" or "not attributable to a landing" and files
  nothing. The red then looks like a long-running flake rather than one
  landing's regression.

## What it looked like

`92af4b79b` dropped the per-workstream emoji from `bin/lib/session-registry.sh`,
`bin/lib/launch-session.sh` and `bin/workstreams`. The same commit updated the
four `workstreams-app/` tests that assert the record shape — those are in the TS
graph — and missed `bin/test/workstreams.list.doctest.md`, which asserts
the exact JSON of a `bin/workstreams list --json` row including `"emoji":"🧵"`.

It was red across five full-suite runs over about two and a half hours, alerting
each time and attributed to nothing, until `3ce51589a` corrected the expectation.
The ledger shows the signature: `165 runs, 5 fail, 0 flake, 5 unimplicated` —
every failure unattributable, none ever reclassified as a flake.

## Why the fix is not just a wider regex

Widening `SOURCE_LITERAL` to `bin/<name>` covers a test that names the script it
spawns, but not this case. The emoji change's real content was in
`bin/lib/session-registry.sh`, which the doctest never mentions; `bin/workstreams`
reaches it through `source`. Useful selection needs the shell `source` graph,
the way `cliBundleInputs` already stands in for the bundle's transitive inputs.

Fail-open is the other option worth pricing: treat any `bin/**` change as
implicating every test that spawns any `bin/` script. That is ~52 files, which
is a large selected run but a correct one, and it matches how a `dist/cli.mjs`
ref already fails open to any `beebox/src/` change.
