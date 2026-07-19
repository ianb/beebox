---
title: "fake-agent.ts: pre-existing single-export lint errors want a file split"
resolution: implemented
---

**Closed (2026-07-14): resolved via a scoped rule exception, not a split.** The
file's 5 exports are ONE cohesive test fixture — the `createFakeAgent` factory
plus the fixture's own types (`FakeAgent`, `FakeAgentOptions`,
`FakeAgentInvocation`) and the error it throws. Splitting into ~5 single-export
files would fragment a single fixture across the tree, which is worse than the
debt. With the boxholder's explicit sign-off, `single-export` is scoped **off for
`test/helpers/fake-agent.ts`** in `callback-box/eslint.config.mjs` (a file-scoped
config carve-out with justification, alongside the existing `return-await` one —
not a global weakening, per the CLAUDE.md lint policy). The blast radius was 6
importers, not "every doctest" as this note originally overstated. (The file
still carries 7 unrelated `no-restricted-syntax` warnings — `??` and one inline
union — minor separate debt, left as-is.)

2026-07-04 · later task.

`callback-box/test/helpers/fake-agent.ts` carries 4 pre-existing
`single-export` ESLint errors (plus 7 warnings) — verified present at HEAD
before the 2026-07 session-resume work touched the file. Clearing them
means splitting the shared test helper into single-export modules, which
touches every doctest that imports it — mechanical, but wants its own pass
with the full suite run.

Do NOT weaken the rule to avoid this (root CLAUDE.md lint policy).
