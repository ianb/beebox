---
title: "tour-lib predates the stricter lint preset"
---

`callback-box/test/tours/tour-lib/` has ~41 lint violations under the
current preset (single-export-per-file — types.ts alone exports 15 —
plus template-literal Errors and non-literal RegExp in browse.ts).
Nothing enforces lint on `test/`: the lint-staged patterns and
`pnpm lint` cover `src/` only, so this never blocked a commit and only
surfaces via the per-edit hook when someone touches these files.

Two questions, both unsettled:

1. Should `test/` code be lint-enforced at all? If yes, tour-lib needs
   a conformance pass (the single-export rule implies real file
   splits); if no, that's a deliberate config decision worth one line
   in code-style.md so per-edit hook reports on test files stop
   reading as pre-commit blockers.
2. If conforming, do it as its own pass — don't let it ride along in
   an unrelated diff.

Filed while formalizing tours (docs/tours.md); the 2026-07-10 fixes to
checkpoint.ts/browse.ts/runner.ts deliberately did not expand into
this cleanup.
