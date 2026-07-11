---
title: "Pre-v2-migration chat sessions are unresumable on prod (project-dir hash changed with content/); schedule-fire responses into them vanish silently"
area: callback-box
filed-by: agent
discovered-in: worktree-memory-use — live-testing chat-schedule firing under the lazy hub
resolution: wontfix
---

Closed 2026-07-11: the delivery-loss half (tension 2) was fixed the same day —
schedule fires now fall back to a fresh session (`f54f44d2`,
`routes/chat-schedule-fire.ts`), so nothing is silently lost. The data-repair
half (migrating pre-v2 project dirs so old sessions resume) the boxholder
explicitly doesn't care about; old sessions stay unresumable.

Resuming any chat session created before a box's v2 `content/` migration fails
immediately: the SDK returns `error_during_execution` with `num_turns=0
duration_ms=0`. Observed on prod (`personal` box) when a chat `<schedule>`
fired into the most-active session `9b256d7f…` (husk
`store/chat/web/2026-06-28_9b256d7f.chat.card`, `context-dir:
store/callback-box`).

Cause: the session's transcript JSONL lives under the Claude Code project dir
for the PRE-migration cwd —
`~/.claude/projects/-home-callback-boxes-personal-store-callback-box/` (no
`content` segment) — but v2 resumes spawn with cwd
`<boxRoot>/store/callback-box` where boxRoot now includes `content/`, so the
SDK looks in `…-personal-content-store-callback-box/`, which doesn't exist.
The prod `~/.claude/projects/` listing shows a whole family of stale
pre-migration dirs (`-home-callback-boxes-personal`,
`…-personal-store-writing`, `…-personal-store-spanish`, …) whose sessions are
all presumably unresumable the same way.

Two tensions to resolve:

1. **Data repair** — migrate/merge the old project dirs to their
   content-including names (rename dir, or move the JSONLs), per box, on the
   server AND on any local machine with the same history. A husk's
   `session:`/`context-dir:` fields identify what maps where. One-time
   migration script territory (`docs/migrations.md`).
2. **Failure visibility** — a schedule firing into an unresumable session
   loses the agent response with only a `hub-child.log` line
   (`[chat-session] Turn ended with is_error=true`). For an alarm/reminder
   that's a silent delivery failure. Consider: on resume failure during a
   schedule fire, fall back to a fresh session (the content is
   self-contained) or surface the failure somewhere the boxholder sees.

Not related to the 2026-07-11 lazy-hub/keepRecent work — the same failure
happens on any serve restart (every deploy) followed by a resume of an old
session, chat UI included.
