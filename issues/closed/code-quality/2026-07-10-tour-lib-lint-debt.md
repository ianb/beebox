---
title: "tour-lib predates the stricter lint preset"
workstream: unknown
resolution: implemented
---

**Closed 2026-07-15:** Resolved on this worktree's branch
(worktree-tour-lib-lint). Question 1 answered yes — `test` was added to the
`roots` option in `beebox/eslint.config.mjs`, so `test/` is now held to
the same reviewed vibe-check ruleset as `src/`/`scripts/` instead of falling
through to eslint-config-agent's harsher unreviewed global base; `pnpm lint`
and lint-staged now cover `test/` too. Done as its own pass (question 2), not
riding along in an unrelated diff. Remaining substantive violations fixed:
custom error classes in `runner.ts` and `chat-session-spawner-helpers.ts`,
centralized escaped-regex construction in
`test/tours/tour-lib/snapshot-regex.ts` (one justified
`security/detect-non-literal-regexp` disable), and cast removals in test
helpers. See `code-style.md`'s "Type Checking and Linting" section for the
one-line note this warranted.

**Update 2026-07-15:** `single-export` was removed from the preset entirely
(boxholder decision — see
[closed/decisions/2026-07-15-single-export-should-ignore-types](../decisions/2026-07-15-single-export-should-ignore-types.md)),
so `types.ts`'s 15 exports and the bulk of the count no longer trip anything. The
remaining violations here are the substantive ones (template-literal Errors,
non-literal RegExp in browse.ts); question 1 below is now just "should `test/` be
lint-enforced at all," no longer entangled with a file-splitting mandate.

`beebox/test/tours/tour-lib/` had ~41 lint violations under the
preset as of filing (single-export-per-file — types.ts alone exports 15 —
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
