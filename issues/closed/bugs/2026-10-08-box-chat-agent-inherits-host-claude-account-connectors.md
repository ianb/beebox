---
title: "Box chat agents load the host Claude account's connectors and user settings"
workstream: unattached
area: beebox
labels: [security, privacy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08 by `boxSessionSettings` (`beebox/src/core/agent/box-session-settings.ts`):
box Claude sessions load only the `project` setting source, exclude every
`CLAUDE.md` above the box root, and set `disableClaudeAiConnectors`.

## Resolution 2026-10-08

Call sites checked: `services/claude-chat/core.ts` (chat, cold and warm
spawns) and `core/agent/invoke/run.ts` (every agent run: reactor, procedures,
triage, chat review) now use the helper; `services/scan-vision-claude.ts`
already had `settingSources: []` and now also turns connectors off. Not box
sessions: `scripts/sdk-steering-probe.ts` (temp dir), the Codex backends, and
the monorepo's quota tools (`bin/agent-quotas-*`, `workstreams-app`).

A second leak path showed up in verification. The CLI loads every
`CLAUDE.md` in the directories above its working directory as project memory,
so a box under the home directory loaded `~/.claude/CLAUDE.md` even without
the `user` source. The helper excludes those paths with `claudeMdExcludes`.

Verified with one real chat turn through the chat backend against the
worktree's test1 clone. Without the options: 54 `mcp__` tools, including the
claude.ai connectors. With them: no `mcp__` tools in the init message or the
transcript's `deferred_tools_delta`; the transcript's instruction files are
the box's `CLAUDE.md`, `.beebox/agent-guide.md`, `_content/briefing.md` and
the box's other `@` imports, with nothing from `~/.claude`; the box skills
(`beebox-system-feedback`, `email`, `views`, …) still list.
Pinned by `beebox/test/core/agent/invoke/run.box-context.doctest.md` and
`beebox/test/services/claude-chat.doctest.md`.

Production runs the same code path (the bundled server builds chat and agent
options through the same functions). The production host itself was not
inspected. The CLI still adds the login's email address to the session
context; no SDK option turns it off. That is filed separately as
[box agent context carries the host login's email](../../bugs/2026-10-08-box-agent-context-carries-host-login-email.md).

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

More sessions loaded the connectors. [B2](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (R1): three box transcripts list the host's Google Drive, Claude Docs and browser tools, and the host user's email. [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (R4): both box-agent sessions list Gmail, Google Calendar, Google Drive and Claude Docs in `deferred_tools_delta`; Admin Overview shows "Logged in as" the host account (row 65). [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 8): the agent offered to look through the person's Gmail. No `mcp__` tool call occurred in any of these boxes. The A and D reports do not mention the connectors.

## Production (2026-10-08)

Production was exposed. On the production host, 731 of 1,261 box-agent
transcripts from 2026-08-29 to the morning of 2026-10-08 list the host
account's claude.ai connector tools, and four sessions called them (Drive,
Claude Docs, and Gmail search). The fix is deployed in `9a8bcae8d`, and the
production bundle contains it. Specifics are kept privately.
