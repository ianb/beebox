---
title: "Box agent context carries the host Claude login's email address"
workstream: unattached
area: beebox
labels: [privacy]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — verifying the box-session settings fix, 2026-10-08
---

Every Claude session beebox starts for a box gets a `session_context`
attachment with the email address of the Claude account the server process is
logged in to: "The user's email address is <login email>. Use it only to
identify the user…". In a box with several members, the agent is told that one
person's address belongs to "the user", whoever is chatting.

Seen in a real chat turn against the worktree's test1 clone after
[the connector and user-settings fix](../closed/bugs/2026-10-08-box-chat-agent-inherits-host-claude-account-connectors.md).
That fix removed the claude.ai connectors and the host `CLAUDE.md`; this line
remained.

## Mechanism

The bundled Claude Code CLI (agent SDK 0.3.290) builds the user context from
the OAuth account's `emailAddress`. The only switch found in the binary skips
it when `ANTHROPIC_UNIX_SOCKET` is set, which is unrelated transport
configuration. The SDK types expose no option for it.

## Open question

Whether to ask for an SDK option, run box sessions under a login without a
personal address, or accept it. Production uses a subscription login
(`beebox/docs/server/configuration.md`), so its box agents likely see that
account's address; the production host was not inspected.

## Re-encounter 2026-10-09 (journey walks)

Present in every walk of the round: `userEmail` in the box agent's session context in all of [A](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md), [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (also in title runs, two occurrences per transcript), [C](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md), [D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md), [D2](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) and [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md). No agent used it.
