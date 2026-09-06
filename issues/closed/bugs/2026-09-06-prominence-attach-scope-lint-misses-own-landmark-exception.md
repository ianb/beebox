---
title: "The inside-attach-scope prominence lint doesn't know an attach scope can hold its own landmark"
workstream: card-visibility
area: beebox
priority: normal
labels: [prominence, landmarks, lint]
filed-by: agent
discovered-by: agent
discovered-in: card-visibility worktree, Track D (landmark-links-prominence migration), running against the test1 clone
resolution: implemented
---

> Closed 2026-09-06 (card-visibility, Track E): fixed in the same worktree with doctest cases — see the plan `beebox/docs/plans/card-prominence.md`.

`src/core/lint-prominence.ts`'s `attachScopeWarning` fires "prominence inside
an attach scope has no effect; mark the owner card, or list it in the
landmark's `links:`" for ANY `primary`/`entry-point` card living inside an
owned `<basename>.attach/` directory (`isInsideAttachScope` +
`isOwnedAttachScope`), with no exception for an attach scope that holds its
own `*.landmark.card`.

But `prunedSubtree` (`core/landmark/prominence-index.ts`) DOES special-case
that: when a landmark's own directory IS an owned attach scope (the landmark
lives inside it, as `test1`'s `_content/courses/Acids_Bases.attach/Acids_Bases.landmark.card`
does), `prunedSubtree(boxRoot, thatDir)` walks it as an ordinary top-level
directory — it's the landmark's OWN home, not something skipped. Cards
inside it that carry `prominence` DO have real effect on that landmark's own
derived list (the Landmarks page), even though compact Browse still folds
the directory away structurally (Browse's fold is about the attach-scope
*shape*, independent of `prominence`).

So the lint's message is wrong for this specific case: it says the field
"has no effect" when it does have effect on the owning landmark's own
derived list. Reproduced by the `landmark-links-prominence` migration
(`docs/plans/card-prominence.md`, Track D) against `test1`: marking
`Acids_Bases_Lesson_Plan.lesson-plan.card` and `Acids_Bases_Progress.progress.card`
`prominence: primary` (both are in-subtree targets of the
`Acids_Bases.landmark.card`, which lives inside the very attach scope those
two cards are also inside) makes `bbx validate --all` print two
`inside-attach-scope` warnings that don't apply here.

Fix shape: `attachScopeWarning` (or its caller) needs the same "unless that
scope holds its own landmark" check `prunedSubtree`'s walk already has —
probably by checking whether `findLandmarkCardName` (or an equivalent) finds
a landmark directly in the attach directory, and skipping the warning when it
does.

Non-blocking: `ProminenceLintWarning` severities are "warning"/"info" and per
its own doc comment "never counted toward `bbx validate`'s exit code
regardless of severity", so this is a false-positive info surface, not a
correctness break in derivation itself.

