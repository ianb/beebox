---
title: "Box chat agents load the host Claude account's connectors and user settings"
workstream: unattached
area: beebox
labels: [security, privacy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
---

A box chat session runs with every claude.ai connector of the Claude account
the server process is signed in to, and with that account's user-level
settings. In the 2026-10-08 C-reconnecting walk, the box had no Gmail
connector configured. The chat agent still offered the person:

> If you contacted him over the summer by email, I can look through your Gmail
> to see whether you actually sent it and whether he replied.

The session transcript lists `mcp__claude_ai_Gmail__*`,
`mcp__claude_ai_Google_Calendar__*`, `mcp__claude_ai_Google_Drive__*`, and
Claude Docs tools as deferred tools. The context also held the developer's
`~/.claude/CLAUDE.md`, the developer's email address, and a user-level hook.
The walker declined, and no Gmail tool was called (the session made only
`Bash` calls). A "yes" could have led the agent to search the developer's real mailbox from
a disposable test box and written the result into it.

## Mechanism

`beebox/src/services/claude-chat/core.ts` (the `queryOptions` built for each
chat) sets no `settingSources` and does not restrict MCP servers. The SDK
default loads user and project settings, so the session inherits the account's
claude.ai connectors and the user's global instructions and hooks. Other call
sites already opt out: `core/agent/invoke/run.ts` passes `settingSources: []`
when it does not load box context, and `services/scan-vision-claude.ts` is
hermetic.

## Why this is not only a dev problem

Production authenticates with a subscription login
(`beebox/docs/server/configuration.md`, "Transferring the Claude login"). If
that account has claude.ai connectors, every box user's chat would get them.
That is one person's mail offered to every member of a box. This was not
verified on the production host.

## Open question

Box chat needs the box's own project settings (skills, rules, hooks under the
box). The fix is probably `settingSources: ["project"]` plus an explicit
claude.ai-connector opt-out. Confirm that box-level skills and the
`git mv` hook still load, as `core/box/guidance-sync/skills.ts` notes.

## Re-encounter 2026-10-08 (journey walks)

More sessions loaded the connectors. [B2](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (R1): three box transcripts list the host's Google Drive, Claude Docs and browser tools, and the host user's email. [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (R4): both box-agent sessions list Gmail, Google Calendar, Google Drive and Claude Docs in `deferred_tools_delta`; Admin Overview shows "Logged in as" the host account (row 65). [C](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 8): the agent offered to look through the person's Gmail. No `mcp__` tool call occurred in any of these boxes. The A and D reports do not mention the connectors.
