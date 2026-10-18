# Track V evidence: is `t.check` a sound destination?

Plan: [retire-doctest](../../beebox/docs/plans/retire-doctest.md), track V.
This file is the tracked summary. Transcripts, scored runs, and corpus files
are in the worktree's gitignored `scratch/doctest-trials/`. Track 6 deletes
this directory.

## 1. Differential translation test

**Method.** Every doctest (1,094 files) was converted with the typed upgrade
in differential mode (`bin/doctest-convert/differential.ts`). For each check
with a typed form, the run evaluated the doctest's text check as the test's
assertion, then compared the typed check against it on the real value and on
mutated copies: one changed leaf (up to three leaves), a number or boolean
leaf made a string, an added key, a dropped key, a dropped item, an added
item, and two items swapped.

**Result (2026-10-18, converter at 7a1abca45).**

| | Count |
|---|---|
| Checks with a typed form | 11,173 |
| … of which `JSON.stringify(x)` unwrapped to `x` | 2,622 |
| Typed check failed on the real value (kept as text) | 236 |
| Mutated values tried | 31,470 |
| Typed check passed where the text check failed (looser) | **0** |
| Typed check failed where the text check passed (stricter) | 3,286 |

No typed check was looser than its text check, which is the gate's first
criterion.

**Key order** (rerun at 52b62f21d with a "reverse key order" mutation,
33,681 mutated values): 1,645 typed checks pass where the doctest's text
check fails, all of them on key order alone; 1,608 are unwrapped
`JSON.stringify(x)` checks. No typed check is looser on any other mutation.
`t.check` compares objects without regard to key order by design, so these
checks stop asserting the order in which the code built an object. Whether
any of them meant to assert it is a boxholder decision; the alternative is
to keep those 1,645 as `checkText`. The stricter cases are expected: a number and its string print
the same text, and a text wildcard can span what the typed form checks.

A first run (converter 9365791de, before the unwrap) kept 2,824 checks as
text. Their first mismatches were 2,557 "expected an object or array" and
247 "not equal"; 2,632 of the 2,824 checked `JSON.stringify(x)`. Unwrapping
`JSON.stringify(x)` and `JSON.stringify(x, null, n)` brought the count to
236. The typed check ignores key order, which the JSON text compared.

**Where all 12,319 doctest checks land** (rerun at 5d64af3f9, after the
`&&`/`||` lint rule, frontend lint from its own directory, and explicit
`undefined` arguments allowed; with the lint loop: a typed check lint
rejects is kept as text with the reason):

| Form | Checks |
|---|---|
| `t.check`, typed | 9,317 |
| text: lossy actual (`.length`, `===`, `.includes`, `&&` over them); phase 3 strengthens | 1,583 |
| text: printed output (`print()`) | 710 |
| text: multi-line text | 381 |
| text: typed check failed on the real value | 236 |
| text: structure that is not a literal (`Map(1) {…}`, a wildcard key) | 46 |
| text: type error | 37 |
| text: `() => undefined` inside the checked expression (the pipeline's lint loop counts any `no-useless-undefined` finding in a check) | 2 |
| text: a whole-value wildcard, `«show»` | 7 |

Runtime fidelity at the same commit: 1,089 of 1,094 files pass with tap's
assertion count equal to the manifest's; the five others are explained in
the plan's track 2 result.

## 2. Mistake corpus

22 small tests, each with one realistic mistake, written against one subject
module. What each layer reports, after the fixes below:

| # | Mistake | Type checker | Lint | Run |
|---|---|---|---|---|
| 01 | misspelled key | `'nmae' does not exist` | — | missing key names `name` as the near miss |
| 02 | `any(String)` on a number | `StringPattern` not assignable to `Pattern<number>` | — | `does not match a string` |
| 03 | `t.check(promise)` without `await` | — | — (typed lint covers `src/` only) | the test waits for the check and reports it |
| 04 | `checkText` on an object | — | — | text diff; works, weaker |
| 05 | patterns where a fixed value fits | — | — | passes (guidance only) |
| 06 | `.length` checked | — | `check-whole-value` | passes |
| 07 | made-up expected value | — | — | per-path mismatches and a suggestion |
| 08 | `JSON.stringify` checked | — | `check-whole-value` | passes |
| 09 | `a === b` against `true` | — | `check-whole-value` | passes |
| 10 | expected left out | — | — | suggestion with `uuid()`/`isoDate()` |
| 11 | `optional()` on a required key | `Optional` missing `test`, `match` | — | passes |
| 12 | key not listed | `'id' does not exist` (actual typed `object`) | — | `unexpected key; … add [others]` |
| 13 | `Date` against `"2026-10-18"` | — | — | names the full ISO string it matches |
| 14 | right items, wrong order | — | — | suggests `unordered([...])` |
| 15 | `void t.check(...)` | — | `no-voided-check` | fails as expected |
| 16 | key left out of expected | `Property 'createdAt' is missing` | — | `unexpected key` |
| 17 | tap's `t.equal` / `t.ok` | — | — | passes |
| 18 | wrong error name | — | — | diff and the thrown error |
| 19 | `capture().value` read before a match | — | — | `has not matched a value yet; run the check that uses it first` |
| 20 | doctest `«int»` in a `t.check` string | — | — | says `t.check` does not read `«»` and points at `str` |
| 21 | `anything()` as the whole value | — | — | refused, with a suggestion |
| 22 | `.includes()` checked | — | `check-whole-value` (names `containing`) | passes |

**Changed because of the corpus:**

- 03: `t.check`, `t.checkText`, and `t.checkThrows` hold their test open
  until a pending check settles (`t.waitOn`). Before, a slow un-awaited
  check ran after its test ended.
- 01, 13, 14, 20: the run's message now names the fix.

**Not caught by any layer:** 05 (a pattern where a literal fits) and 17
(tap's own field asserts). Both are judgment the guidance covers. A lint
rule against tap's field asserts in tests is possible; it is a human
decision because 7 existing test files use them.

**Not fixed:** 11's message (`Optional<number>` is missing `test`, `match`)
does not say that `optional()` is for optional keys; `check.md` does.

## 3. Usability trials

**Method.** `scratch/doctest-trials/harness.py`. Each run gets a fresh
worktree slot at the branch commit, with the cutover notice in place
(track 1b). The model gets a one-paragraph brief, as a person would write
it, with no syntax hints. Haiku and Sonnet run as `claude -p` with project
settings (so the per-edit lint hook runs); Luna runs as `codex exec -s
workspace-write`. Each task's code carries two to four hidden mutants tied
to the brief's contract; the model's tests run against each.

`luna-verify` is the same brief plus one process sentence: "Run the tests
you add or change before you finish."

| Task | Haiku | Sonnet | Luna | Luna-verify |
|---|---|---|---|---|
| T1 tests for an untested pure function | pass, 4/4 | pass, 4/4 | pass, 3/4 and 4/4 | pass, 3/4 |
| T2 route test with `makeTestServer` | pass, 4/4 | pass, 4/4 | **fails** (did not run it) | pass, 4/4 |
| T3 update a failing test after a deliberate change | pass, 4/4 | pass, 4/4 | **fails** once (did not run it); then pass, 4/4 twice | pass, 4/4 |
| T4 convert a doctest by hand (doctest catches 1/4) | pass, 1/4 | pass, 1/4 | **fails** (did not run it) | pass, 1/4 |
| T5 fix lint and type errors in 4 converted files, expected values untouched | clean | clean | 1 `max-lines` left | (brief names the verify commands) |
| T6 strengthen a converted file (it catches 0/4) | pass, 4/4 | pass, 4/4 | pass, 1/4 | pass, 1/4 |
| T6b the same, briefed "check the whole value the code returns" | | | pass, 4/4 twice | |
| T7 capture an id, then check a list | pass, 4/4 | pass, 4/4 | pass, 4/4 | pass, 4/4 |

"4/4" is hidden mutants caught. Across these runs: no lint findings except
one `better-regex`, no type errors, no `checkText` for values, no
`eslint-disable`.

**Findings.**

- **Every model writes whole-value `t.check` without hints.** Luna wrote T1
  as one `t.check` over a table of four lookups.
- **Luna does not run tests unless told to.** Three of its failures say so
  in its own last message ("I haven't run the test"). One sentence in the
  brief fixes it. The phase 2 worker brief already names the verify
  command; a phase 3 brief must too.
- **T6: "keep what each check covers" was taken literally by Luna:** it
  made each directive check exact, and so missed directives the doctest
  never named. Haiku and Sonnet checked the whole policy. Briefed "check the
  whole value the code returns" (T6b), Luna caught all four mutants in both
  runs. The phase 3 brief uses that wording.
- **T4:** all three conversions are faithful: each catches what the doctest
  catches, and no more.
- **T5** (round 4, revised brief): every run kept every expected value and
  marker. The first brief forbade touching any check call; all three models
  had to break that rule, because lint findings sit inside checked
  expressions (a callback `t` shadowing the test's, `.sort()`, an
  `undefined` argument, a generic `Error` thrown in a fake). Sonnet said so
  in its report; Luna reported "No `t.check*` calls … were changed" though
  it had renamed variables inside three. The rule is now: expected values
  and markers do not change; a checked expression may change only to
  satisfy lint, keeping its value. Round 3 also showed eslint run from
  `beebox/` ignoring the frontend file (so `bin/test-roots.ts` names each
  root's lint directory), and Haiku editing a shared `src/types` file and
  two fixture modules to clear type errors outside the batch.
- **Haiku** used `t.ok(device); if (!device) return;` to narrow a nullable
  value before using it (T7). `check.md` now shows `capture()` for this.
  It also ran `pnpm install` in an installed slot (T4), a rule break.
- **The mutant miss in T1** ("a key without `/` is not a family") is a case
  none of Luna's names exercised; Haiku and Sonnet tested it.

## 4. Generative reviews (codex gpt-6-sol)

**Before phase 1** (2026-10-18; 20 proposals; answer in
`scratch/cross-model/2026-10-18T01-16-59-899Z-codex.md`). Taken, with the
boxholder's reactions:

- Hidden regression mutants in trials: done (section 3).
- A zero-model conversion path: done; the converter's output passes with
  no worker for 581 of 1,094 files on lint, and fidelity holds for all.
- Complete HTTP and CLI observations: `TestServer.response()` and
  `runCommand`/`tsxCommand` (track 1a).
- Failures that name the violated constraint: per-path mismatch lists,
  and the hints added from the mistake corpus.
- Exact unordered collections with multiplicity: `unordered`, `containing`.
- Captures for relationship tests: `capture()`; T7 exercised it.
- Mechanically reliable lint checks: `check-whole-value`, `no-voided-check`.

Not taken in phase 1: rejected-async and stream observations, numeric
tolerance beyond `closeTo`, DOM observations, unseen qualification tasks
separate from learning rounds (the trials used fresh slots but the same
tasks), cost per accepted conversion, prose as a second source of intent,
replayable worker repairs, property-based input, and compact large
failures.

**After the trials** (2026-10-18; 9 proposals; answer in
`scratch/cross-model/` beside `generative-after.prompt.md`). Adjudication,
recorded in the plan:

| Proposal | Decision |
|---|---|
| Correct Luna's T5 gate entry (one `max-lines` left) | done |
| Rerun T1/T3/T5 with the exact worker brief before the gate closes | added to the gate |
| Count the key order the `JSON.stringify` unwrap stops checking | measured: 1,645 checks (below); boxholder decision |
| Flag edited checked expressions for review | added to `verify` |
| Measure phase 3 gains with held-out weak forms | added to track 5 |
| A typed assertion for exactly `undefined` | decided 2026-10-18: lint allows `undefined` arguments; 76 such checks are now typed |
| A cross-root pilot before calibration | added to track 3 |
| Classify the 3,286 stricter cases | not yet: they make tests stricter, never looser |
| Reconcile the two runtime counts | done (the two "count-mismatch" files equal their doctests) |
| Lint for `checkText` on objects and tap field asserts | boxholder decision |

**Adversarial review of the upgrade** (same reviewer; 5 findings): fixed
`anything()` matching `undefined` and two reorder-hint bugs; documented
`uuid()`/`.int()` widening; key order is the boxholder decision above.

## 5. Fresh gate run

At a6119b0db, every brief with the verify sentence (T5's brief also names
the verify commands), Haiku and Luna:

| Task | Haiku | Luna |
|---|---|---|
| T1 | pass, 4/4 | pass, 3/4 |
| T3 | pass, 4/4 | pass, 4/4 |
| T5 | clean, no expected value or marker changed | clean, no expected value or marker changed |

Haiku ran `pnpm install` in T1 (its second time across the trials). A first
attempt at this T5 run was discarded: the key-order differential had left
probe-mode files in the scratch conversion that the T5 setup copies from.
