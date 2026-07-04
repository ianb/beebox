# fake-agent.ts: pre-existing single-export lint errors want a file split

2026-07-04 · later task.

`callback-box/test/helpers/fake-agent.ts` carries 4 pre-existing
`single-export` ESLint errors (plus 7 warnings) — verified present at HEAD
before the 2026-07 session-resume work touched the file. Clearing them
means splitting the shared test helper into single-export modules, which
touches every doctest that imports it — mechanical, but wants its own pass
with the full suite run.

Do NOT weaken the rule to avoid this (root CLAUDE.md lint policy).
