# Tranche brief

You are applying the test-value criteria in `research/test-value/README.md`
section 4 to a tranche of test files, and recording what the application
cost and whether the mechanical flags were right. Read README sections 4
and 5 first (`sed -n 255,360p research/test-value/README.md`).

Criteria codes: K1 bug replay / names a failure that happened; K2 trust,
privacy or containment boundary; K3 contract another system reads; K4
branch guard whose comment names the breaking edit. M1 snapshot of a
generated set; M2 pinned wording that is a choice; M3 second proof across
files or layers; M4 weak form with a real claim. X1 restates code or a
convention; X2 tests the framework, a fake, or a type; X3 exploration with
no stated reason. OK = keep, a plain branch guard that no code names.

Mechanical flags in `research/test-value/application/checks.jsonl` (per
check: file, line, lhs, rhs, flags) are candidates. Your job is the
judgment.

For each file in your tranche:

1. Note the wall-clock minute you start.
2. Read the whole file and the code under test as far as needed.
3. For every `t.check`, decide the code. Group checks that share one
   disposition and reason into one ledger row (give the line range).
4. Apply the disposition in the file: X → delete the check (and the test
   block if empty, and the lead comment); M4 → rewrite to a whole-value
   check that fails when the behavior breaks; M1 → narrow to the rows the
   claim needs, or keep and say why narrowing loses the claim; M2 → narrow
   to the part that is the feature; M3 → delete the copy outside the code's
   home. K and OK → no edit. When the rewrite needs a real value you cannot
   derive by reading, run the file once with the expected value left out
   and paste the printed value, then say in the comment why it is right.
5. Run the file from its package directory: `cd <package> && pnpm exec tap
   <path relative to package>` (for `beebox/src/frontend/test/...` run from
   `beebox`). It must pass. If tap cannot start, record that and move on.
   Do not reinstall anything. Do not run the full suite.
6. Note the minute you finish.

Do not commit. Do not touch files outside your tranche except the ledger.
Do not change source under test. Leave a test alone when you are unsure
and say so in the row.

Write rows to `research/test-value/application/ledger-<tranche>.csv` with
this header, one CSV row per disposition group, quoting fields with commas:

file,lines,n_checks,flags,disposition,mech_right,action,lines_removed,confidence,note

- flags: the mechanical flags on those checks, `-` if none
- mech_right: Y the flag named the real problem; N the flag was wrong; P
  partly; `-` no flag
- action: none | removed | rewrote | narrowed | merged
- confidence: high | medium | low
- note: one sentence, why

And a per-file summary to `research/test-value/application/files-<tranche>.csv`:

file,minutes,checks_before,checks_after,lines_before,lines_after,test_result,obstacle

- test_result: pass | fail | could-not-run
- obstacle: one sentence if anything slowed you (a fixture you had to
  understand, a value you had to run to get), else `-`

Finish with a short report: for the tranche, which dispositions came up
most, whether the flags pointed at the right checks, what judgment the
flags could not make, and any criterion that did not fit a case you met.
Use plain sentences; no adjectives of assessment.
