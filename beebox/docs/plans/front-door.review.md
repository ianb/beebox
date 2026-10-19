# Plan Engineering Review — front door

Cross-model plan review, round 1: `codex gpt-6-sol`, effort high, 2026-10-19.
Prompt and raw answer under `scratch/cross-model/` (untracked). Each finding
was verified against the source before the plan changed.

## What already exists

Confirmed by the reviewer and by the planner: root arrival and the place page
(`docs/landmarks.md`), "Also here", the stock openers and their briefing
rule, `foldListing`, `TodoSummaryLine`, `getNavCounts`, the `what-can-you-do`
skill. The reviewer opened seven files beyond the read-list and named them.

## Ontology (verified against the code's own names)

"Plate line" and "place summary" are existing names. "Stock summary",
"seeded empty folder", and "Whole box" are new terms the revised plan
defines. No finding against the ontology.

## Prior art (external) — verified

None needed; the plan depends on no external premise.

## Stated preferences this plan trades against

Two findings (1, 2 below) were about preferences the first draft traded
against without saying so plainly enough. Both are now named in the plan.

## Could this be simpler? (verified)

The reviewer's most important change: present the stock text as orientation
and not as the first-run menu, keep the phone's first screen in question 1,
and bring arrival, counts, Browse, and the page offer as separate choices.
Applied: the third opener moved from the lean to an alternative; the stock
text's examples are phrased as examples; the phone gets the stock sentences
in Track A; questions 1 to 6 are separate.

## Failure modes

Findings 5, 6, 8, 9 were silent failures in the first draft. All four are
fixed in the plan and have a test row in its Failure modes table.

## Agent-flow / user-flow edge cases

Finding 9 (the agent could not see that the body was stock) is an agent-flow
gap; fixed by having the root-landmark reader return the body.

## Findings

### 1. The stock text read as the first-run menu
**Location in plan:** Track A, Track F
**Citation:** issue 2026-07-20, boxholder: "a firm menu of a few complete flows, each with a real payoff"
**Issue:** three activities and a "build me a page" opener on an empty box presented a generic menu where the boxholder asked for walked flows.
**Why it matters:** a promise on the first screen that no one has walked end to end.
**Suggested action:** orientation only; cut the opener.
**Adjudication:** accepted. Text reworded; opener moved to question 6's alternative.

### 2. Track B reverses a direct decision
**Location in plan:** Track B
**Citation:** landmark-arrival decisions, "(d) ... option 1" and design "a place with one entry point opens that card"
**Issue:** the root exception was presented as a fix, not as revisiting a decision.
**Adjudication:** accepted. Track B and question 2 now say so and carry both options; the lean stays.

### 3. The orientation fix was invisible on the phone
**Location in plan:** Design, "When it goes wrong"; question 7
**Citation:** anchor issue: "Any sentence anywhere telling me what this app is"
**Adjudication:** accepted. Track A shows the stock summary's first two sentences in the phone's empty root chat; question 1 includes the phone; question 7 now asks only about the agent's later summary.

### 4. Track D hung navigation on a listing-only toggle
**Location in plan:** Track D
**Citation:** `browse-card-state.ts:51` (directory always a string); `BrowseSidebarBody/hook.ts` (toggle owned by the sidebar body)
**Adjudication:** accepted; verified. Track D is now a navigation change: Browse starts at `_content`, a "Whole box" row reaches `""`, the toggle is untouched. Estimate raised.

### 5. "Same query" was false
**Location in plan:** Track C
**Citation:** `nav.tsx:120`: `trpc.status.navStatus.useQuery()`; `status.ts:165-169`
**Adjudication:** accepted; verified. Track C uses `status.navStatus`; a failed query renders "Counts unavailable", distinct from zero.

### 6. `TodoSummaryLine` cannot render a questions part
**Location in plan:** Track C
**Citation:** `TodoSummaryLine.tsx:18-22`; `summary.ts:39-41` returns `null` for an empty reduction
**Adjudication:** accepted; verified. `CountsLine` extracted; `rootLineParts` does not call `summaryParts`; questions-only is a named test.

### 7. The fold could not identify a template folder
**Location in plan:** Track D
**Citation:** `browse-fold.ts:126`; a cardless folder with a saved PDF
**Adjudication:** accepted. Folding is limited to seeded `_content` template paths (`box-layout-spec.ts`) with no cards and no landmark; a person's own folder never folds; a PDF-only seeded folder is a listed failure row (one click away).

### 8. Repair would prepend stock prose to a person's body
**Location in plan:** Track A
**Citation:** `defaults.ts:256-258`: `templateContent + body`
**Adjudication:** accepted; verified. Repair builds its template without a body and adds the stock one only when the existing body is empty; tested.

### 9. The "Front page" reminder had no data path
**Location in plan:** Track A
**Citation:** `compile/core.ts:77-82` reads frontmatter openers only
**Adjudication:** accepted; verified. The root-landmark reader returns the body; the compiled line is emitted on trimmed equality with `STOCK_ROOT_SUMMARY`.

### 10. "Nothing saved here yet" restored a removed claim
**Location in plan:** Track E
**Citation:** `place-shows-cards.md`, Track A: "cannot promise the folder is empty"
**Adjudication:** accepted. Copy is "Nothing to show here yet. Tell me about something in the chat and I'll keep it here."

### 11. The gloss arrived after the label; root label conflict unstated
**Location in plan:** Track E
**Citation:** `PlacePill-panels.tsx:90`; `defaults.ts:234-238` vs glossary "box" entry ("the root place is 'Home'")
**Adjudication:** accepted. The gloss goes under the menu row where the word is first met; the slug-versus-Home conflict is question 5b with a lean.

## NOT in scope (verified)

The reviewer raised nothing against the list. Starters, onboarding
directory, agent-first turns, reminders, search, dashboard, phone arrival,
courses, existing boxes' bodies remain out.

## Things I checked and found clean

The index redirect, the root listing filter, the recursive `fileCount`, the
"Also here" group, the openers hiding rule beside an unstarted chat, and the
display-path leak check were cited correctly and the reviewer did not
dispute them.
