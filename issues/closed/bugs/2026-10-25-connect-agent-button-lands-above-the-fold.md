---
title: "\"Connect an agent\" opens the Admin tab but leaves the sign-in section below the fold"
workstream: bug-burndown-5
resolution: implemented
area: beebox
filed-by: agent
discovered-by: human
discovered-in: box-isolation — the boxholder, reauthenticating a production box after the per-box-user migration, 2026-10-25
labels: [ux, admin]
---

> **Closed 2026-10-27 (bug-burndown-5):** "Connect an agent" (and the
> owner's automatic redirect) now opens Admin with the Claude Code section as
> the landing target; the Agents tab opens from that section. Landing scrolls
> the section to the top and focuses it, with an accent ring while it holds
> focus; the same applies to notification `admin:<section>` targets and the
> overview's section links. DOM test:
> `src/frontend/test/components/agents/AgentReadiness.connect-lands-on-sign-in.test.ts`.
> Checked in the browser on test1: `/admin?section=claude-code` lands on the
> Claude Code section with it focused.

The chat composer's "No agent is connected yet" block has a "Connect an
agent" button. It opens the right Admin tab, but the page lands at the top of
that tab and the sign-in controls for Claude Code and Codex sit below the fold,
so the person has to know to scroll. The boxholder's words: "It does open the
right tab of the admin, but doesn't clearly go to the re-authentication
interface, which is below the fold."

Expected: the button lands on the sign-in section (scroll into view, or a
fragment the Admin page honours), with the section visibly focused.

Where: the readiness block is driven by `agents.readiness`
(`src/webapp/trpc/routers/agents.ts`); the Admin agents section is
`src/frontend/src/components/admin/` (the Claude and Codex sign-in machines,
`claudeAuthMachine.ts`). Not investigated: whether the Admin route accepts a
section fragment today.

**2026-10-25 (retrospective 20261025-233625):** Unfixed at this date, so no
regression test exists yet. The fix should come with one: a DOM test
([DOM tests](../../../beebox/docs/testing/check.md#dom-tests)) that follows the
button's link and checks that the sign-in section is the scroll and focus
target.
