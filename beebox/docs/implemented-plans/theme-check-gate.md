---
title: "Make theme-check a landing gate"
status: implemented
workstream: theme-check-gate
issues:
  - ../../../issues/closed/bugs/2026-11-13-theme-check-runs-are-fragile.md
  - ../../../issues/closed/bugs/2026-11-12-theme-check-all-fails-on-chrome-and-chat-misses.md
  - ../../../issues/closed/code-quality/2026-11-12-theme-check-shared-sheets-not-yet-covered.md
  - ../../../issues/closed/bugs/2026-11-12-badge-tones-below-aa-on-their-fills.md
  - ../../../issues/closed/decisions/2026-10-21-rose-trellis-nav-labels-below-aa.md
---
# Make theme-check a landing gate

Make a complete `bin/theme-check --all` run trustworthy, then remove the known misses so it exits zero. Keep the theme studio faithful to real components and preserve the look of each theme.

**Issues addressed:** the four runner, coverage, and contrast issues above. The Rose Trellis decision remains a visual constraint until the boxholder approves a revised look.

## Design

No product design section: this restores a developer audit and corrects existing contrast. It adds studio specimens of existing UI states, not a new product experience. The boxholder reviews all visible color changes in one before/after exhibit before landing.

## Smallest fix and budget

The smallest plausible fix is to wait for the studio, give sessions unique names, run all cases, and patch only the current misses. This plan adds a failure-only diagnostic run and makes all shared sheets accountable because both are explicitly requested. Aim for about 1,100–1,600 changed source and test lines, additions plus deletions: runner and tests 350–500; studio and shared-sheet audit 500–750; palette and theme CSS 150–250. Authored documentation other than this plan: about 50 lines. Generated screenshots and run output are separate artifacts. Reassess before exceeding 2,000 changed lines.

## Stated preferences this plan trades against

The package `AGENTS.md` says, *"Work only on the requested problem"* (`beebox/AGENTS.md:9`); limit changes to the gate and its diagnosed misses. The Rose Trellis decision says, *"The boxholder chose to keep the current look over a darker bar"* (`issues/closed/decisions/2026-10-21-rose-trellis-nav-labels-below-aa.md:15`); preserve the gradient and seek a smaller chip fill, subject to visual approval. The gate must reject unmeasured text: `theme-check.ts:115` says, *"an unmeasured run is not a passing one."*

## What already exists

- `bin/theme-check:22` already invokes the TypeScript tour with `"$@"`; extend its usage text only. `BrowseSession` already offers `open`, `eval`, `run`, and `close` (`tour-lib/browse.ts:72-75,88-101,162-165`); reuse these for readiness and cleanup.
- `theme-check.ts:54-67` builds all catalog cases; `:213-223` builds contrast and screen jobs and makes `--all` fail on misses. Keep this case definition and exit contract.
- `theme-check.ts:26-30` has selector exemptions with reasons. `:39-42` excludes nine shared sheets, and `:154-160` reports uncovered rules. Use this mechanism only for states that the studio cannot reasonably show.
- `tour-lib/rules.ts:97-99` removes pseudo-elements from selectors before matching. A selector consisting only of `::selection` or `::highlight` becomes empty and can report a false miss; map that reduced selector to a universal target and test it.
- `ThemeStudioHarness/chat.tsx:53,90` renders a queued `UserMessage`, while the real pending HQ component renders `.bbx-chat-pending-material` (`components/chat/everywhere/InteractiveChat/pending-hq-message.tsx:33-41`). The class also occurs on undelivered actions (`components/chat/user-message/undelivered.tsx:56-64`). Add a faithful specimen of a real owner; retain the queued user entry for its distinct state.
- `components/ui/Badge.tsx:4,18-25` defines six tone pairs, and `:27,39` adds a separate material-neutral pair. The studio needs all seven visible pairings, with real `Badge` instances.

## Prior art (external)

No external premise controls the design. The runner uses existing `bin/browse` commands, Node filesystem APIs, and the repository's rule matcher. No external pattern is adopted.

## Ontology

- **Catalog case** (existing, `theme-check.ts:54-67`): a system theme/stock and card theme/stock combination, identified by `caseName` (`:96-99`). It is not a screenshot.
- **Job** (existing, `theme-check.ts:163`): a catalog case, screen, and contrast or screen audit. A failed job is not a full-run result.
- **Last-run record** (new): failed jobs and whether full coverage needs rerunning, written only after a completed run. It is diagnostic state, not a landing pass.
- **Rule target** (existing, `theme-check.ts:124-130`): a CSS selector target collected for a case; it may match in any case. It is not inherently failed because one case lacks it.

## Tracks / scope

### 1. Reliable runner and failure-only diagnostics

**What and why.** The first open reads geometry before the studio appears (`theme-check.ts:105-109`), and sessions use fixed names (`:170`). A reload during a long run invalidates measurements. A failed full run currently requires rerunning every job.

**Direction.** Wait with `bin/browse wait --fn` for `#bbx-theme-studio-scroll` after each `open`, with a bounded timeout and a clear readiness error. Give each process a random run ID and use it in session names and a default per-run artifact directory; preserve explicit `--out`. Snapshot a deterministic fingerprint of every path, mtime and size under `beebox/src/frontend/src` and `beebox/src/shared`, plus the Tailwind palette configuration before the first job and check it before and after every job. A changed fingerprint aborts with a clear source-edit/reload message. Existing dirty edits are allowed, so theme iteration remains possible. Also attach a marker on the studio scroller after readiness and verify it after each job, so an HMR reload between source scans cannot silently continue. Treat both as a run error, exit 2, and close sessions in `finally`. Keep only one process's artifacts in its own directory.

Write one `last-run.json` at the output root by temporary file and atomic rename only after a completed run. It stores failed jobs and whether rule coverage failed. An interrupted run writes nothing. Concurrent runs write separate temporary files; the last completed rename wins. Store screenshots in a run-ID subdirectory beneath the output root to prevent collisions even when callers share `--out`. On `--failed`, rerun the last completed run's failed jobs; if it had uncovered rules, rerun every catalog screen job because matching is aggregated across cases. Completed failure-only runs replace the record so retries shrink. Validate persisted jobs against the current catalog/screens. A partial rerun reports "rule coverage not checked" and never calls the full coverage reporter. No prior record, malformed state, or `--failed --all` is a clear error. Only a complete `--all` exit zero is a landing pass.

**Vocabulary lock-ins.** CLI `--failed`; failed job key is case name + screen + kind. Exit 0/1 for completed full `--all`; exit 2 for infrastructure or interrupted runs. `--failed` is diagnostic only.

**First implementation chunk.** Add readiness, unique sessions/output, source/reload detection, the atomic failure record, and focused tests of selection/completion/concurrency behavior. Update usage text. Commit this isolated runner slice.

### 2. Studio fidelity and shared-sheet coverage

**What and why.** The queued user entry does not exercise `.bbx-chat-pending-material` (`chat.tsx:53,90`; `pending-hq-message.tsx:37`). Nine shared sheets are excluded (`theme-check.ts:39-42`).

**Direction.** Add the real `PendingHqMessage` with fictional data and inert callback to the conversation. Audit all unmatched rules in each excluded sheet. For a live, reproducible state, add a small studio specimen using its real component and actual props: turn state, plain/inset/nested quotes, disabled swatch, figure error, card-back field list, tab overflow, Updating badge, as applicable. For a selector with no production owner, document the search and delete it. For a transient or inaccessible state that cannot be represented faithfully, add a narrow selector exemption with a written reason. Remove a sheet from `SHARED_NOT_YET_COVERED` once every rule in it matches, is deleted, or is exempt; ultimately remove the list if empty. Do not exempt a rule merely to make the count zero.

Fix pseudo-only selector reduction in `tour-lib/rules.ts` so `::selection` and `::highlight` are checked against a universal element target instead of an empty selector. This is a matcher correctness fix, with a focused test, not a theme-rule exemption.

**Vocabulary lock-ins.** Existing `RULE_EXEMPTIONS` remains the sole exception list. A shared sheet stays in coverage after its audit.

**First implementation chunk.** Add pending material and the simplest shared-sheet specimens, remove corresponding sheet exclusions, then run targeted coverage to enumerate remaining rules. Commit the complete coverage slice once all nine sheets are accounted for.

### 3. Existing contrast misses

**What and why.** The reported misses were Rose Trellis nav at 3.1–3.8:1, the Phosphor placeholder at 2.75:1, Veil/Overprint near 4.5:1, and warning badge text at 2.5:1.

**Direction.** Put every `Badge` tone and material-neutral variant in the studio, measure every actual fill/ink pair, and change only pairs below 4.5:1. The initial palette calculation found warning about 2.46:1 and danger about 2.55:1; the other named pairs are at least 5.06:1. Confirm these with the rendered audit. Prefer a local Badge pair if a shared palette token has other uses. For Rose Trellis, do not darken the preserved nav gradient; try the smallest chip fill that passes over its warm end. Adjust Phosphor, Veil, and Overprint at the narrowest CSS selector. Compare before/after screenshots of every changed theme in one labeled exhibit, with captions naming what a person sees. Obtain the boxholder's visual approval before landing; do not treat a passing ratio as approval of appearance.

**Vocabulary lock-ins.** Existing tone names and theme names remain unchanged.

**First implementation chunk.** Add badge specimens, measure the pairs, then make minimal color edits. Record before and after captures for the exhibit.

## Could this be simpler?

Only fixing the current CSS misses would make one `--all` run green but leave cold-open, concurrent-run, edit/reload, and coverage failures untouched. The extra runner state is limited to a last-run failure record; it supports the requested `--failed` loop without letting an interrupted run masquerade as a gate pass. A general scheduler, database, or persistent browser service buys nothing here and is excluded.

## Subplans

None: the runner, studio, and CSS changes have narrow dependencies and no separate vocabulary or schema decision.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Cold router returns before studio scroll mounts | Real cold-open diagnostic | Bounded wait, exit 2 | Clear |
| Two processes start together | Concurrent one-job browser diagnostics | Random IDs, isolated artifacts, atomic record | Clear |
| Frontend changes or HMR reloads mid-job | Real source edit during a browser job | Abort run, preserve previous record, exit 2 | Clear |
| A worker throws while peers are active | Real interrupted-run session cleanup | Stop taking jobs, await peers, close all sessions | Clear |
| Process dies before the run completes | Record preserved in source-edit diagnostic | Previous record unchanged | Clear |
| `--failed` is run without a prior completed run | Focused retry-state tests | Exit 2 with instruction to run an initial check | Clear |
| A shared selector matches only another case | Existing all-case coverage aggregation (`theme-check.ts:154-156`) | Full coverage for rule misses | Clear |
| A new specimen is visually outside the measured scroll | Full audit and screenshot review | Offscreen/unmeasured count fails (`theme-check.ts:115-118`) | Clear |

## Agent-flow / user-flow edge cases

- **ADDRESSED:** Working tree already dirty before the run. Baseline the current source, so theme iteration can start a run; changes during it abort.
- **ADDRESSED:** Two concurrent audits finish in opposite order. Independent screenshot directories prevent overwrites; the last atomic record rename wins.
- **ADDRESSED:** Last full run has rule misses. `--failed` audits coverage across all cases and labels its result diagnostic.
- **ADDRESSED:** A false-positive dead selector. Search production owners before deletion and inspect selectors that match generated markup; exemptions require a precise reason.
- **DEFERRED:** A person rejects a proposed contrast color. Keep the previous look and revise the narrow color treatment for a new exhibit; do not land that visual change without approval.
- Card refs, agent tags, migrations, and free-form data do not apply to this dev-only audit.

## NOT in scope

- A new theme or broad visual redesign; the request concerns existing misses.
- Changing the contrast threshold or exempting visible text to obtain a pass; this would weaken the gate.
- Reworking `bin/browse` globally; the runner can use its existing API.
- Automating the visual approval decision; the boxholder judges the exhibit.

## Open design questions

The exact Rose Trellis chip fill depends on measured screenshots and the boxholder's visual choice. This does not block the first runner chunk. There are no other design questions before implementation.

## Knowledge audits

No box-agent concept changes. This is developer tooling and studio coverage, so no box knowledge audit is needed.

## What will hold this after it ships

Focused `.test.ts` tests with `t.check` cover failure-record replacement, parsing, stale catalog validation, and retry selection. Real browser diagnostics cover cold opening, concurrent processes, and source-edit interruption; marker-only reload and browser-daemon death remain source-reviewed paths. The real `--all` browser gate verifies coverage, contrast, and the cold-open behavior. The browser run is the landing check, not a substitute for tests of runner decisions. No new test tier is introduced.

## Implementation order

1. Runner reliability and `--failed` semantics; focused tests; checkpoint commit.
2. Real pending material and complete shared-sheet rule audit; checkpoint commit.
3. Badge specimens and narrow CSS fixes; before/after captures and one exhibit; checkpoint commit.
4. Focused tests, `pnpm typecheck`, `pnpm layout-check`, changed-file lint, then exactly one clean `bin/theme-check --all` confirmation at a time. Get cross-model review, adjudicate findings, and update the plan. Stop for visual approval before landing.

## Rollout shape

No data migration. Run focused tests first, targeted theme checks during iteration, and one complete `--all` after edits settle. A clean `--all` exit zero, empty or reasoned shared-sheet exclusion list, concurrent-run and cold-open evidence, typecheck, layout-check, lint, and cross-model review are required. Commit within this worktree; merging and deployment wait for the boxholder's later finish request.

## Plan review adjudication

Claude fable reviewed the plan on 2026-11-15. Accepted the single atomic failure-record design, explicit omission of partial coverage reports, scroller marker checked after each job, broad source fingerprint, and pseudo-only selector fix. Kept per-run screenshot subdirectories to prevent concurrent screenshot collisions; they remain beneath the documented artifact root. The older Rose Trellis decision permits a human-approved exemption, but this implementation will first present a small chip fill. Rejection leaves the gate goal pending a human decision; it does not silently weaken contrast enforcement.

## Implementation evidence

- The queued user message and pending HQ transcription are different production states. The studio now renders both; `PendingHqMessage` moved to the shared chat component directory without changing its production markup.
- All nine shared-sheet exclusions were removed. Live quote, card-back, disabled-swatch, tab-overflow, updating, and figure-error states have specimens. No production selectors were deleted. Only card-turn transforms and their busy opacity are newly exempted because settled screenshots cannot show their 140–180ms transition; both final faces are measured.
- Figure errors retain their existing red fill and text; declaring their own semantic ink makes that intentional material explicit. Their text contrast remains measured.
- The cold-open diagnostic passed after stopping only this worktree's process. Two concurrent one-job diagnostic processes passed. A source edit after the first screenshot caused exit 2 with a source-change message and preserved the previous failure record.
- Targeted phone and laptop captures pass for Rose Trellis, Veil, Overprint, Phosphor, and all Badge tones. Rose keeps its original gradient; only chip fills deepen.
- Change-selected tests ran 51 files and 413 assertions. Three assertions in the todo rendering test needed the new Badge class; that file then passed all 29 assertions. No other files failed. Typecheck, layout-check, and changed-file ESLint passed. Retry-state tests also rejected deliberately removed malformed-state and partial-coverage guards, then passed after restoration. The final `bin/theme-check --all --jobs 2` run exited 0: 25 catalog cases, 50 contrast jobs, and 150 backdrop/coverage jobs passed. Its completed record has no failed jobs and no pending coverage.

## Implementation review adjudication

Claude `claude-opus-5-5` reviewed the implementation. Accepted the misplaced Updating indicator, shared gold-token side effect, and misleading browser-death diagnostic; these are corrected. The disabled card swatch now reuses its production component. Figure error and inset-view wrappers remain exact small fixtures because mounting their full owners requires a throwing sketch or a running authored view; their production owners are named beside the fixtures. They are not evidence of those owners' behavior.

Kept the specified last-completed-run semantics, including previews and concurrent last-completion wins, rather than adding per-run retry history. The CLI identifies preview versus full-catalog provenance and case count; the authoring guide explains separate output roots for independent histories. Added capture-retention guidance rather than deleting evidence automatically. Corrected the plan's test claims to distinguish unit tests from real-browser diagnostics.

## Coverage exposed a hidden status

The first full catalog attempt after moving the workspace status to its real position reported that Updating was never measured. A focused phone hit test confirmed that the card at z-index 1 covered its sibling status at z-index auto. The shared status rule now paints at z-index 2 and provides neutral ink, paper, and border fallbacks, since it cannot inherit the child card's material. Before/after status captures join the visual exhibit. No contrast or occlusion check was weakened.

## Semantic badges on dark cards

The next catalog attempt exposed six false surface-inversion reports for the newly visible Badge tones on Night Atlas. These badges have their own solid palette rather than inheriting the card material. They now declare that material explicitly with `--bbx-ink: currentColor`; the material-neutral Badge retains its card inheritance. A targeted Night Atlas and Phosphor probe passed, while deliberately restoring the old warning text color still failed at 2.46:1. No text threshold changed.

Claude verified the status stacking/fallback fix and the narrow Badge material boundary in a final follow-up. It found no counterexamples, and confirmed that material-neutral and all badge text checks remain active. The visible status correction joins the human approval gate.

## Landing evidence

The final full run was `25502-c65f0559`; local evidence is in `scratch/theme-gate/full-complete.log` and `scratch/theme-gate/full/last-run.json`. It passed 25 catalog cases, 50 contrast jobs, and 150 backdrop and coverage jobs. The boxholder approved the “Theme contrast before and after” exhibit in chat on 2026-11-15, including the four theme color changes, Badge tones, and the now-visible Updating status. The Rose Trellis decision is resolved with the original gradient preserved.
