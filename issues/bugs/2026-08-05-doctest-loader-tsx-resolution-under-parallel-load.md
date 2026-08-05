---
title: "Doctest loader intermittently resolves .tsx schema modules as missing .ts files"
area: callback-box
filed-by: agent
discovered-in: worktree-tab-organizer-clerk — full finish-suite verification
---

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
