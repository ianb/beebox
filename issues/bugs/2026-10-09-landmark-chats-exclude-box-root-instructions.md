---
title: "Landmark chats exclude the box's own root AGENTS.md and rules since the host-isolation fix"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-agents-md — while planning the box AGENTS.md migration
---

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
