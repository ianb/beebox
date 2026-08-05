---
title: "Doctest loader intermittently resolves .tsx schema modules as missing .ts files"
area: callback-box
filed-by: agent
discovered-in: worktree-tab-organizer-clerk — full finish-suite verification
resolution: implemented
---

Resolved in `d590ed90` with a deterministic loader guard added in this worktree.
The workspace upgrade from tsx 4.22.3 to 4.23.1 removes redundant extension
probes under Node 24 synchronous module hooks. The doctest resolver now also
maps `./module.js` directly to an existing `module.tsx` when no `module.ts`
exists, so a downstream probe cannot stop at the missing `.ts` candidate. A
regression test forces that downstream failure. A stress run passed 24
simultaneous schema-registry TAP files (1,728/1,728 assertions). The six-job
callback-box suite passed 6,163/6,163 in 140 seconds, compared with 588 seconds
before the upgrade.

A full parallel `pnpm test` run produced 272 failures whose child processes
reported missing modules such as `src/schemas/feedback.ts`, `guide.ts`,
`capture-session.ts`, and `scheduled-script.ts`. Those modules exist as `.tsx`
files, and the failures ended as `1..0 # no tests found`. The same run still
completed many sibling doctests normally.

The affected changed test, `test/webapp/trpc-clerk.doctest.md`, passed 7/7 when
rerun alone with one job. This points to an intermittent interaction between
the doctest ESM loader, the tsx loader, and parallel TAP child startup rather
than a missing source module.

Investigate why `.js` imports are sometimes resolved to a nonexistent `.ts`
candidate without continuing to the existing `.tsx` module under parallel
load. A reliable regression should start multiple doctest child processes that
import `src/schemas/registry.ts`, not merely loop a single isolated doctest.
