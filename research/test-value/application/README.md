# Applying the criteria: 60 files, 2026-10-23

Snapshot of one judgment pass over 60 test files, run to see what the
section-4 criteria do when applied and how far the section-5 mechanical
flags get a reader. The edits sit in the commit that carries this note;
nothing is merged.

## Method

`scripts/enumerate.py` flagged every `t.check` in the 1,332 test files
(`files.csv`, 11,981 checks). Five tranches (`tranches.csv`) took the
files the flags ranked highest, one tranche per flag, plus a control of 16
unflagged files drawn at random:

| Tranche | Files | Chosen by |
|---|---|---|
| A-weak | 16 | most M4 weak-form flags |
| B-snapshot | 12 | most M1 long-literal flags |
| C-wording | 8 | most M2 third-party-wording flags |
| D-shared | 8 | most expected literals shared with another file (M3) |
| E-control | 16 | no flag at all, at least 3 checks |

One reader per tranche followed `BRIEF.md`: read the file and the code
under test, give every check a code, make the edit, run the file, write a
ledger row per disposition group (`ledger-<tranche>.csv`) and a per-file
line with minutes and the run result (`files-<tranche>.csv`). Readers could
not change source. One sibling test file outside the tranches was edited
where an M3 deletion needed it (`run.box-context`).

## Outcome

| | Checks | Share |
|---|---|---|
| Judged | 1,338 | |
| Keep (K1 to K4, OK) | 1,116 | 83% |
| Rewrote to a whole value (M4) | 106 | 8% |
| Narrowed (M1, M2) | 42 | 3% |
| Merged (M3) | 11 | 1% |
| Removed (X1, M3 copies) | 59 | 4% |

Lines in the 60 files: 17,180 to 16,486. All 60 files pass after the
edits; typecheck and lint on the changed files pass.

Disposition by checks: K4 387, OK 281, K1 152, K2 149, K3 147, M4 119, X1
39, M3 24, M2 23, M1 17. No X2 and no X3 in 1,338 checks; the 10-08 sweep
took those.

Removal rate by tranche: A 0.2%, B 11% (one catalog file supplied 22 of
the 29), C 1%, D 15%, E (control) 4%. The control's 4% is the base rate
for an unflagged file. Scaled to the suite that is about 500 checks, and
the earlier estimate of 800 to 1,700 was high: X2 and X3 are gone and X1
is concentrated in a few files that restate a constant.

Cost: 60 reader-minutes of wall clock across five parallel readers, about
835k tokens, roughly one minute and 14k tokens per file, 2.6 minutes per
edited check. Readers batched reading across files, so per-file minutes in
`files-*.csv` are apportioned.

## Were the flags right

Per flagged check, `mech_right` from the ledgers (Y the flag named the real
problem, P partly, N wrong):

| Flag | Flagged checks judged | Y | P | N | Y+P |
|---|---|---|---|---|---|
| M4-weak | 346 | 91 | 29 | 226 | 35% |
| M1-snapshot | 246 | 13 | 39 | 194 | 21% |
| M2-wording | 42 | 4 | 6 | 32 | 24% |
| M3-shared | 31 | 6 | 0 | 25 | 19% |

Per file the flags still enrich: the edit rate in flagged tranches was 9%
to 24% of checks against 6% in the control, and the two files with the
most removals (`card-theme`, `view-url`) were both flag picks. The flags
rank files usefully and name checks badly.

Why each flag was wrong, from the rows:

- **M4** fires on the expected literal (`true`, `false`, `null`, a number).
  Two thirds of those are functions whose return *is* the boolean
  (`isDue`, `isAttachRef`, `verifyScanToken`, `openAccess`). The real weak
  form is a lossy projection on the left: `.success`, `.ok`, `.pass`,
  `.length`, `.code`, `.status`, `.includes(...)`, `.matches(...)`,
  `some(...)`, `[a, b].join(",")`, a template string of fields. The flag
  missed those when they sat inside a `map`, an object property, or a
  template literal (`question` 147, `box-maintenance` 62, `migration-sweep`
  535). `tap-check/test/lint/plugin.test.ts` has no `t.check` at all; its 14
  flags were string fixtures inside RuleTester.
- **M1** fires on length. Long literals are the house whole-value form of a
  parser segment, a lint result, a counter record, or a written card. The
  real M1 cases were a helper's output pinned as a literal
  (`createBriefingTemplate()` text in `briefing-openers`), one whole object
  repeated across checks for one claim (`emission-persist`, `voice-intent`),
  and a hand copy of an exported list (`voices`, 13 names).
- **M2** matched zod's vocabulary, which our own `regex(..., message)`
  calls use too. 44 of 50 pinned strings were the box's own message that a
  person reads, a TAP diff the `tap-check` package exists to produce, or an
  enum discriminant (`invalid-or-gone`). It was right on four zod built-in
  messages in `hub/config` and missed a Node ENOENT message and a Markdoc
  message that carried no flag.
- **M3** by byte-identical literal: 8 of 12 shared literals were fixture
  coincidences (`{email:null,name:null,source:null}` reached by different
  forgery routes; `[true,true,false,false]` from unrelated predicates; a
  stderr line that is one file's output and another's input). The real M3
  cases had different literals for the same function and inputs
  (`resolveRelativePath` in `view-url` against `ref-path`).

What no flag described, found only by reading: a one-line wrapper restated
(`issueCategoryId`), a fixture's own list length pinned (`runBurst`), a
registry restated row by row (`THEME_CATALOG`, `FEATURE_LIST`), an in-file
second proof (`verifyHubSecret` then the resolver on the same request), an
`.ok` check made redundant by the `.data` check after it.

## Judgment the flags cannot make

- Whether a boolean is the function's return type or a comparison the test
  built.
- Whether a repeated whole value is a boundary enumeration (eight counters
  per scenario in `run-target`, 26 routes in `workstreams-app` auth) or a
  snapshot of one claim.
- Whether a pinned message is ours or a library's, which decides between
  pinning the message and pinning the path.
- Whether wording is the feature: the fence messages in
  `namespace-fence-traversal` are bare on purpose so no "did you mean"
  leaks for an escape; `dismiss`'s error sentence is the only output the
  agent sees; `Heading`'s classes are half of the claim "the level changes
  the look".
- Which file is a claim's home. Twice the home was neither file: the rule
  lived in a third module (`ref-path/core.ts`) or an untested one
  (`box-session-settings.ts`), settled by a comment deferring one way.
- Whether a narrowed form is deliberate because the whole value would be
  an M1 snapshot (`checkCode` on a long brief; `includes(PROBE)` on the
  migration registry; `result.success` where the whole result is 18
  generated paths). One M4 rewrite produced an M1 and was reverted.

## Criteria that did not fit a case

- **M3 as written says across files or layers.** Five rows were in-file
  duplicates: byte-identical consecutive checks (`emission-editor`), the
  same route proved twice in one test (`auth.hub-identity`), one list at
  the function layer and the hook-report layer in one file
  (`system-cards`). Readers coded them M3 and said so.
- **M3 needs an exception for agreement as the claim.** `card.get-body-offset`
  checks one locator through two layers because the claim is that the
  layers agree.
- **M4 has no target when the whole value restates the implementation.**
  `husk-transcript` line 40's `not(unbound)` is a weak form; the whole
  value would copy the code.
- **A negative timing claim has no whole value.** Four 100 ms `Promise.race`
  checks in `box-maintenance` claim "the drain has not finished". The only
  code that fits is flake risk, which is not a disposition.
- **Catalog rows restated are X1 in bulk.** `card-theme` pinned every
  `THEME_CATALOG` entry (22 checks, 150 lines); `features.test.ts` pinned
  `FEATURE_LIST`. X1 said "a lookup, a one-line comparison"; the volume
  form is a table of constants mirrored into expected values.
- **Pass-through third-party text with the comment saying it is the
  feature** (zod in `browser-task-batch`, Markdoc in `markdoc-and-husks`):
  the row mixes in-house kind and path with the library's message, and no
  narrowing keeps the whole-value form. Left with a medium-confidence note.

## What this changes in the criteria

Recorded in README section 4 under "Revisions after application". In
short: M4's signal moves to the left-hand projection; M1's signal moves
from length to "helper output, exported constant, or one object repeated";
M2's signal becomes "the literal does not occur in `src/`"; M3 gains an
in-file clause and an agreement exception; X1 gains the restated-catalog
form, which is the largest removal in the sample; and the sweep should
rank files by flag density and hand a reader the file, since the flags are
right about files and wrong about checks.
