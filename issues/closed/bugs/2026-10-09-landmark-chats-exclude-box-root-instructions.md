---
title: "Landmark chats exclude the box's own root AGENTS.md and rules since the host-isolation fix"
workstream: agents-md
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-agents-md — while planning the box AGENTS.md migration
---
**Closed (implemented).** Resolved by 2eb6dc739, b6ff23681, b59c118d0, 4792b639e: landmark chats pass `boxRoot` so the exclude list starts above the box root, and append the box root's expanded @-includes as BOX CONTEXT (degrading only on unsafe includes).

A chat bound to a landmark runs the SDK with `cwd` set to the landmark
directory. `beebox/src/core/chat/session/run/start.ts:122`:
*"const cwd = contextDir ? path.join(ctx.boxRoot, contextDir) : ctx.boxRoot;"*

The chat backend then builds the exclude list from that `cwd`, not from the box
root. `beebox/src/services/claude-chat/core.ts:114`:
*"...boxSessionSettings({ boxRoot: opts.cwd, loadBoxContext: true }),"*

`ancestorInstructionFiles` in `beebox/src/core/agent/box-session-settings.ts`
lists every `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `.claude/AGENTS.md`,
`.claude/CLAUDE.md`, and `.claude/rules/**` in each directory above its
argument. For a landmark chat, the box root is one of those directories. So
the box's root `AGENTS.md` (which
includes the agent guide and the briefing) and the box's `.claude/rules/` are
excluded from landmark chats. The box root rides `additionalDirectories`, which
does not load instruction files.

This started with commit 9b9b0fb16 (2026-10-08), which added the exclude list to
keep host files out of box sessions. Before it, a landmark chat walked up to the
box root. `beebox/src/dev/lib/test-suite-schema.ts:77` still describes that:
*"The directory's own `AGENTS.md` walk-up is what's being audited."*

Not verified with a live landmark chat. The code path is unambiguous, and an SDK
probe (2026-10-09) confirmed that an excluded ancestor file does not load.

Likely fix: pass the real box root to `boxSessionSettings` (the chat options
carry it) so the list covers only directories above the box. Whether landmark
chats should load the full root context is a product question; the
pre-2026-10-08 behavior loaded it.

## Research (2026-10-09/10)

Verified with real sessions built by the chat backend's own `buildQueryOptions`
on a converted copy of the worktree test box. Marker lines were planted in each
context source; the landmark was `_content/courses/Acids_Bases.attach/` (a
course whose `AGENTS.md` says to build from the learner's "dumps something
extra" idea). Script: `scratch/landmark-context-probe.ts` in worktree
`agents-md` (not committed). Sonnet, 3 runs per cell unless noted.

What loads, by session setup:

| Setup | root AGENTS.md | agent guide + briefing (`@` includes) | root `.claude/rules` | `_content/AGENTS.md` | landmark AGENTS.md + include | course exposition rule (after a Read) |
|---|---|---|---|---|---|---|
| today: cwd = landmark, excludes from cwd | no | no | no | no | yes | no |
| excludes from the box root | yes | **no** | yes | yes | yes | not tested |
| same + `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` | yes | **no** | yes | yes | yes | not tested |
| A: cwd = landmark, excludes from box root, root context expanded into the system prompt | yes | yes | yes | yes | yes | yes |
| B: cwd = box root, landmark AGENTS.md expanded into the system prompt | yes | yes | yes | (on read) | yes | yes |

Fixing the exclude list alone does not restore the agent guide: Claude Code
does not expand `@` imports in an instruction file above the session's cwd
(same for `CLAUDE.md`).

Attention to the landmark's instructions ("what's an acid again?"; does the
reply build from the learner's own phrase): today 3/6, A 6/6, B 5/6, an ordinary
root chat 0/6 (textbook definitions every time). Adding the whole-box context
did not dilute the local instructions in this test. A note-taking task ("note
on my progress that conjugate pairs confuse me") succeeded in all 12 runs
across setups, validate clean; with the guide loaded the agent read the
progress-card docs first.

Lean: A. It keeps the landmark as cwd (session history is keyed on cwd,
`chat/session/history.ts:293`; nested files under the landmark still load
natively), and needs two changes: pass the real box root to
`boxSessionSettings` in `services/claude-chat/core.ts:114`, and append the
root's expanded instruction context (`expandInstructionIncludes` on the root
file) to the landmark system prompt in `chat/session/run/start.ts`. It also
makes `CHAT_SYSTEM_PROMPT`'s "the agent guide, already loaded" true for
landmark chats.
