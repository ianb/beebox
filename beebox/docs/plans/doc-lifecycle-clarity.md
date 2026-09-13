---
title: "Make current documentation and historical records distinguishable"
status: active
workstream: prompt-calibration
issues: []
---
# Make current documentation and historical records distinguishable

Readers should know whether a document describes the system now, proposes a
change, or records past work. Status and directory must agree before changes
land on main. Implemented means work shipped; it does not certify that the plan
remains a current operating manual.

The human approved implementation on 2026-09-13 after the lightweight planning
pass. Use existing checks and directory
conventions rather than adding a documentation management system.

## 1. Enforce lifecycle consistency at landing

Extend the existing validator rather than add another checklist.
`beebox/src/dev/doc-frontmatter.ts:70-71` already rejects non-implemented status
inside `implemented-plans/` and inappropriate status inside
`unimplemented-plans/`; it does not reject terminal status inside `plans/`.
Require the complete mapping:

- `plans/`: draft, active, partial.
- `implemented-plans/`: implemented.
- `unimplemented-plans/`: parked, superseded.

Keep the existing exemptions for README and companion review documents. Repair
the three known mismatches (docs-reorg, design-reconciliation, scanner-ingest)
in the same change, moving their companions and fixing links as applicable.
Do not infer that other plans shipped merely because their prose sounds old.

Enforce the same validation against the candidate being landed in `bin/land`
**before** merging, and cover direct commits on main through the commit hook.
The normal commit hook already invokes doc-check for Markdown changes
(`.husky/pre-commit:88`), but a merge does not run that hook; the existing finish
agent's reconciliation instruction is not an enforced gate. Check the final
candidate state, not only the files a session happened to edit. Fail with the
path, status, and required directory. Never automatically declare work shipped.

Add focused coverage for valid mappings, terminal states left in `plans/`, and
a refused landing that leaves main unchanged. Preserve existing valid-landing
behavior. This guarantees the supported landing/commit workflows; hooks cannot
prevent deliberately bypassed Git operations. No application full-suite run is
needed for this gate.

## 2. Correct the map and obvious misfilings

Make `docs/README.md` agree with `docs/plans/README.md`: YAML status is canonical;
remove the obsolete requirement for a prose `**Status:**` line. State document
roles consistently: current reference, active proposal, shipped history,
parked/superseded proposal, dated report, and maintained design rationale.

Move the prompt-calibration pilot and its result artifact into `reports/` with
a date-stamped basename and repair their links. Keep the distinction between
immutable experimental reports and the deliberately maintained security report.
Use existing conventions; do not add mandatory metadata to every Markdown file.

## 3. Remove ambiguity at the current/history boundary

Start with the observed cases: triage, questions, PDF intake, source editor,
and field-test documentation. Inspect the relevant implementation only far
enough to decide which material is current, obsolete, or still proposed.

Put durable operating instructions in current guides. Leave rationale and old
alternatives in history. Each historical document used from a current guide
should identify its current reference near the top, when one exists; label the
incoming link as history. For partial plans, distinguish shipped behavior from
remaining proposals without presenting either as the whole current system.
Where the status cannot be established cheaply, name that uncertainty rather
than relabeling it as verified. This is a bounded cleanup, not a line-by-line
audit of every document.

## 4. Make the distinction visible in navigation

The dedicated Plans page already groups by parsed status. General document
views, Quick Open, and the doc graph do not consistently expose it. Reuse path
classification and existing plan metadata to show compact role/status labels;
keep search matching and ranking unchanged. Use directory roles as categories,
not assertions that every sentence has been verified.

Correct the known stale doc-graph descriptions while touching that surface:
card reference called an RFC, production described as running tsx, and the
retired test-helper path. Avoid a second hand-maintained lifecycle catalog.

## Order and completion

Implement 1 and 2 first: they establish an enforceable baseline. Then do the
bounded content cleanup and navigation labels as separately reviewable changes.
Completion means the landing gate rejects status/location mismatches, the
identified mixed documents have honest destinations and current-owner links,
and navigation exposes their role. Verify links and gate behavior; use a small
browser check for the navigation changes. Do not claim that all historical
prose has been revalidated. Defer broad content sweeps, freshness scores,
automatic semantic classification, and scheduled document audits.

## Implementation checkpoint — 2026-09-13

All four sections are implemented in the prompt-calibration worktree. The plan
remains active until landing; this checkpoint is not a claim that main has it.

- The shared lifecycle validator checks the complete staged index and the
  committed landing candidate before main changes, including missing or invalid
  metadata. Git integration doctests exercise rejection, bootstrap, and valid
  landing behavior.
- The three known completed plans and their reviews moved to shipped history;
  the calibration experiment and its result artifact moved to dated reports.
- Triage and field testing have current guides linked to preserved history.
  Questions, PDF intake, source editor, and the guide index state their roles.
- Browse, Quick Open, and both generated graph forms display document roles;
  plans also display their existing status. Search ranking is unchanged.

Focused validator and Git doctests, navigation doctests, affected typechecks
and lint passed. A browser check confirmed current-reference, dated-report,
partial-proposal, and shipped-history labels and Quick Open navigation.

Source verification found an existing handler transport defect, filed separately
as [TRIAGE_ITEMS truncation](../../../issues/bugs/2026-09-13-triage-items-nul-env-truncates-handler-batch.md).
The current guide describes that limitation; runtime repair is outside this pass.

Independent review corrected stale bare-path references, a contradictory history
summary, and overly broad classification of root-level docs. It also prompted a
batched Git snapshot read to avoid one subprocess per plan on every commit.
