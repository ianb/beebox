---
title: "Todo/Plate view dumps a '75 cards couldn't be read' error list of every non-card file"
workstream: integration-tests
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test onboarding-first-days (dentist-email)
labels: [soft-launch, field-test-findings, code-error]
resolution: implemented
---

> **Closed 2026-08-09.** Two of the three defects fixed:
> the error dump — `listTodoCardPaths` (`src/core/todo/collect.ts`) now scopes
> every glob to `.card` files centrally, so the plate's box-wide `glob: "**"`
> (and project plates' bare directory globs) no longer surface non-card files
> as "couldn't be read" issues; and the due-date off-by-one — real, a
> date-only string parsed as UTC midnight then formatted in the local zone
> (`FriendlyDate.tsx` now pins date-only values to UTC, so `2026-08-14` renders
> Aug 14 everywhere). The remaining raw-`**` defect is the separate
> [markdown-not-rendering](../../bugs/2026-08-08-markdown-not-rendering-in-agent-output.md)
> issue (ui-error, still open).
The todo view (`plate.todo-view.card`, "The Plate") renders two real todos at
the top, then a large box headed **"75 CARDS COULDN'T BE READ"** listing every
non-card file in the box — `briefing.md`, `CLAUDE.md`, `config/cb-validate.ignore`,
`config/connectors/gmail.json`, `config/connectors/gmail.state.json`,
`config/migrations.jsonl`, `config/template-versions.json`,
`docs/generated/*.md`, … — each with "card filename doesn't match the
Name.&lt;type&gt;.card pattern". The block runs well past the fold and dominates the
page. Screenshot: the run's `screenshots/dentist-email/02-todos-plate.png`
(verified by eye, not just operator-flagged).

The view is walking files that were never meant to be cards and reporting their
non-card-ness as read errors surfaced to the user. A normal box is full of
`.md`/`.json`/config files; every one of them shows up here as a scary
"couldn't be read". The todo view should scan only card files (or only its
declared scope), not every file in the tree, and non-card files are not an
error condition to display.

Two smaller defects visible on the same page (fold in or split as you like):
- Raw `**` renders under the "The Plate" heading — unparsed markdown (see the
  separate markdown-not-rendering finding).
- The same todos show "due Aug 13, 2026" on the Plate but the appointment card
  reads `2026-08-14`; at minimum an inconsistent date *format* between views,
  possibly an off-by-one worth checking.
