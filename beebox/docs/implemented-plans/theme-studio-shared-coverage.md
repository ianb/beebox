---
title: "Restore shared theme rule coverage"
status: implemented
workstream: theme-check-gate
issues:
  - ../../../issues/closed/bugs/2026-11-17-theme-studio-misses-current-shared-css-rules.md
---
# Restore shared theme rule coverage

Add faithful specimens for the shared rules absent from Theme Studio.

**Issues addressed:** the shared CSS coverage issue above. Other contrast and audit issues remain separate.

## Design

No design section: this repairs development audit coverage.

## Smallest fix and budget

Extend existing specimens and add a focused presentation state. Estimate 100–200 changed source lines and 30 documentation lines; generated browser artifacts stay in scratch.

## Stated preferences this plan trades against

`beebox/AGENTS.md:9`: "Work only on the requested problem." Keep contrast fixes and audit policy outside this repair. Faithful component specimens are preferable to selector-only dummy elements.

## What already exists

- `src/frontend/src/pages/dev/components/ThemeStudioHarness/cards.tsx:125`: `const mobile = useMobileChatViewport();` lets the existing desk follow actual viewport behavior.
- `src/frontend/src/components/chat/workspace/WorkspaceCanvas/view.tsx:69`: `visible && focused` renders the focus-control wrapper; reuse its structure and real PaneControls in the studio.
- `src/frontend/src/components/Markdown/Quote.tsx:70`: `data-treatment={treatment}` belongs to QuoteBlock; use the real block renderer for explicit layered samples.
- `src/frontend/src/themes/card-themes.css:169`: `.bbx-card-front:has(.bbx-composition-editor) .bbx-card-contents .bbx-card-contents-label` needs an editor and real contents control together.

## Prior art (external)

No external premise: extend the repository's existing React studio and browser tour.

## Ontology

No new domain nouns. A focused specimen is an alternate presentation state with one visible focused card. The tour measures normal navigation before entering focus and then returns through Back to split.

## Tracks / scope

Reproduce the current missing rules. Verify default-layered selectors in the catalog cases that own those defaults; explicit layered QuoteBlock content already exists. Extract the existing composition Frame into a lightweight shared component and mount its real error-state frame beside the existing real contents control. Add a focused studio state selected through the reading desk's real PaneControls; it shows one reading card and hides the other desks. The normal contrast jobs remain unchanged. Laptop screen jobs measure normal rules/backdrops, enter focus, measure rules/backdrops again, then return; the existing job key includes both checks without a persisted state dimension. Focus adds only an icon button, so an additional full contrast scroll pass buys no new text coverage. Ensure normal and focused states are both measured sequentially by the existing tour; preserve the existing catalog, contrast thresholds and unmatched-rule reporting. First chunk is these specimens and the tour state transition together. No new persisted state or vocabulary.

## Could this be simpler?

Static matching wrappers would reduce code but omit the real control markup and could conceal rendering regressions. Reuse the studio's existing desk rather than building another workspace provider or box-dependent route.

## Subplans

None; the specimen changes are one dependent unit.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Focused card hides normal navigation | Browser check both states | Sequential normal and focused measurements | Visible |
| Phone gets desktop-only focus state | Browser phone check | Viewport-gated focused specimen | Visible |
| Quotes parse inline rather than block | Rule audit | Explicit real block renderer | Clear missing rule |
| New content falls outside measured scroll | Existing contrast tour | Unmeasured text fails | Clear |

## Agent-flow / user-flow edge cases

ADDRESSED: no box writes, card mutations, migration or agent vocabulary. Fictional studio content remains fixed. Existing source/reload detection prevents measurements spanning edits.

## NOT in scope

Palette corrections, light-panel inversion policy and test-ledger timeouts have separate issues. Do not add selector exemptions to satisfy coverage.

## Open design questions

None. Inspect the reproduced selector list before choosing exact specimen props.

## Knowledge audits

Skipped: development specimens introduce no agent-facing concept or instructions.

## What will hold this after it ships

The Tempest paired run must retain only its two default-layered catalog selectors as expected single-case residuals. A separate Paper-card probe confirms the layered defaults; cross-pairing itself cannot establish catalog-wide coverage, because both named themes contribute rules for their system and card roles. Browser inspection confirms focused controls and normal navigation coexist in separate boundaries. No new test tier.

## Implementation order

One implementation checkpoint after reviewed plan, then browser verification, selected tests, typecheck/layout/lint and cross-model diff review.

## Rollout shape

Run the targeted Tempest audit before and after, distinguish existing contrast failures from coverage results, and commit verified changes with hooks. No merge or deployment in this task.

## Plan review adjudication

Claude Fable reviewed the plan. Accepted the existing layered specimen finding,
normal-nav visibility risk, exact tour transition requirement and citation fix.
The two default-layered selectors in `materials.css:186,197` belong to catalog
cases such as Paper; the composition selector is `card-themes.css:169`, and
the four focused selectors are `interface.css:182,185,189,192`.
The focused state uses existing real pane controls rather than a new search
parameter or persisted job kind. Normal navigation must be visible before the
first audit. Extracting the production frame avoids a copied editor wrapper.

## Implementation notes

The composition frame lives beside `Composition.tsx`, shared by the lazy editor
and the studio; putting a second entry inside the editor's helper directory
violated the existing layout rule. Browser inspection confirmed desktop focus
has one card, no visible nav or conversation, and a real Back to split control;
phone has no focus controls or focused attribute. Returning restores the nav.

## Verification

`pnpm test:changed` passed eight files and 87 assertions. Typecheck,
layout-check, lint:changed and ui-check passed. Browser probes checked normal
navigation, desktop focus/return and the absence of phone focus controls.
The full `bin/theme-check --all --jobs 6` run completed all 25 catalog cases,
50 contrast jobs and 150 backdrop/rule jobs. It measured all 25 phone and all
25 laptop cases with no contrast misses; backdrop checks had no misses and
shared rule coverage passed. The completed run record has no failed jobs and
no pending coverage. Its local log is in
`scratch/theme-gate/finish-all-jobs6-retry/`.

The separate earlier audit found a swatch-link contrast miss at 3.90:1; that
finding remains in the contrast inventory for its own scope.

Claude `claude-opus-5-5` reviewed the implementation. Its diagnostic findings
were accepted: backdrop misses now name normal/focused state, and focus/nav
failures name the case. Its specimen-drift finding was fixed by sharing the
failed-read body as well as the frame with production. The reading card's
Contents label intentionally stays collapsed while this editor specimen is
mounted; this is the production editing treatment. Catalog-default residuals
remain visible, with no audit-policy change.
The bounded Claude `claude-opus-5-5` verification confirmed all three fixes.
Its remaining diagnostic detail (preserve the nav timeout cause in the printed
message) was added directly and checked against the existing ambient wrapper.

Final paired Tempest run `46884-a1557a86` measured 292 laptop text runs with no
misses, and 279 phone text runs with the known seed-list danger message at
4.43:1. Shared unmatched rules fell from seven to two: only the catalog's
layered-default selectors remain, as expected for Tempest. All five repaired
selectors matched. The run includes the supplemental focused laptop check;
its local log is `scratch/coverage/verified.log`. This is targeted coverage
evidence, not a full `--all` landing pass. Final selected tests again passed
eight files and 87 assertions, and the test command exited zero.

## Authorized landing correction

The boxholder requested a quick fix and landing for the remaining Tempest
seed-list error contrast miss. Its existing ErrorText already reads the card
material. Tempest card danger ink changes from `#ff9cab` to `#ffa3b1`, preserving
the pink while increasing contrast against the previously measured phone
backdrop `#324b73` from 4.43:1 to 4.66:1 by calculation. No other palette token
or audit rule changes.

Rendered verification run `5638-98e0449c` passed all 292 laptop and 279 phone
text runs after the correction. Only the two expected layered-default catalog
selectors remain in this targeted Tempest run; there are no measured contrast
or backdrop misses. Local evidence: `scratch/seed-danger/verified.log`.
