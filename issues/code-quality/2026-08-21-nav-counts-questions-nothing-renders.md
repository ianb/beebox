---
title: "Every page load counts pending questions for a nav badge that no longer exists"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the nav's pending-count user story against the running app
priority: important
---

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
