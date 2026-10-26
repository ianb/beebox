---
title: "\"Connect an agent\" opens the Admin tab but leaves the sign-in section below the fold"
workstream: box-isolation
area: beebox
filed-by: agent
discovered-by: human
discovered-in: box-isolation — the boxholder, reauthenticating a production box after the per-box-user migration, 2026-10-25
labels: [ux, admin]
---

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
