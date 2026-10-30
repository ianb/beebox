---
title: "`AttentionBadgesFace` renders `id=\"bbx-nav-questions\"` twice; `ui-scan.annotations.test.ts` is red"
workstream: bug-burndown-5
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — full suite after the Agent SDK 0.3.310 bump
labels: [test-failure]
---

> **Closed 2026-10-27 (bug-burndown-5):** the two elements were the two modes
> of one control (show-the-question toggle in a chat, Questions link elsewhere),
> never both rendered. They are now one `QuestionsSegment` that carries
> `id="bbx-nav-questions"` once; the Track 4 table row now points at
> `AttentionBadgesFace.tsx`. `ui-scan.annotations.test.ts` passes.

`beebox/src/frontend/src/components/app-bar-faces/AttentionBadgesFace.tsx`
sets `id="bbx-nav-questions"` on two elements (lines 83 and 95). A DOM id must
be unique, and the agent-points-at-UI contract requires each annotation id
exactly once: `beebox/src/frontend/test/lib/ui-scan.annotations.test.ts` now
fails two examples ("The table in docs/plans/agent-points-at-ui.md (Track 4) is
the contract" and "Note what \"exactly once\" is buying") with the unexpected
item `bbx-nav-questions: 2`.

With two matches, an agent that points at "the questions badge" can resolve to
either element.

Introduced by `b43325339` ("Questions: Later, Figure it out, and a daily
review", 2026-10-25). The second element needs its own id (and a row in the
Track 4 table), or the two badges share one annotated wrapper.

Reproduce: `pnpm -C beebox test` (2026-10-26: 12,997 pass, 2 fail, 2 skip).
