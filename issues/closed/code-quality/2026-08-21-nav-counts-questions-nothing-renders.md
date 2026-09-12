---
title: "Every page load counts pending questions for a nav badge that no longer exists"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the nav's pending-count user story against the running app
priority: important
resolution: implemented
---

Closed by this commit (worktree-finish-migrations), by restoring the badge
rather than deleting the count — the boxholder's call once the history was
read out.

The count was not cruft. `QuestionsBadge` was removed deliberately in
`eaa86c79` (Track C3 of `docs/implemented-plans/top-nav-ia.md`, 2026-08-02)
when the bar collapsed to one row, and that plan parks two follow-ups:
"Inline questions (replacement concept) — this plan only removes the Questions
nav presence; page/route/subsystem stay" and "Removing questions subsystem
wire fields — after inline questions." Inline questions was never specified —
no plan, no issue, no code — so what shipped in between was a box whose
pending questions appeared only on the dashboard, with `getNavCounts` counting
them for nobody.

Worse than the wasted count: `/questions` had lost every entry point. The
switch menu's Box submenu carries Dashboard/Browse/History/Storage summary, and
a box gets a Questions row only by naming it in its own `nav.card` (neither
test box has one). A box with 39 pending questions showed no sign of them
outside the dashboard.

So `AppNav` renders `QuestionsBadge` again, fed by the count that was already
being computed, linking to `/questions`, hidden at zero exactly like
`PlateBadge`. It also re-subscribes the `question-answered`/`-dismissed`/
`-expired` bus events — a question leaving the pending set is invisible to the
`card-created`/`file-change` events the bar was left watching. Verified in the
running app on test1: "39 questions waiting for you" beside "3 todos on the
plate". `core/nav-counts.ts`'s header comment ("the two badge counts") is
accurate again, and `trpc-nav-status.doctest.md` needed no change. Inline
questions can still supersede both badges later.

`AppNav` renders one badge, the on-plate todo count
(`beebox/src/frontend/src/components/AppNav.tsx:104-105`, `:140`). The
pending-question badge was removed — a comment at `:116-117` records it ("the
question events this used to watch moved out with the questions badge") — but
the count behind it stayed.

`status.navStatus` still returns both counts (`webapp/trpc/routers/status.ts:65-67`),
and `getNavCounts` still computes both (`core/nav-counts.ts:62-68`). So every
page load runs `countPendingQuestions`, which reads the questions directory
recursively and parses the frontmatter of every question card
(`core/nav-counts.ts:40-59`), and throws the number away. The nav status query
is the one server call every page makes, and the module's own doc comment says
it exists to stay cheap.

The same module still describes itself as "The two badge counts the app nav
renders on EVERY page: pending questions and on-plate todos", which is now half
wrong and reads as a live requirement.

Two things to settle together: whether the questions badge is meant to come
back (the user-story catalog still describes a nav badge for pending questions,
`core-box-r1-37`), and, if not, that the count leaves the per-page query.
`status.status` also exposes `pendingQuestions` for the dashboard, which
computes its own list separately (`components/dashboard/AttentionCards.tsx:20`).
