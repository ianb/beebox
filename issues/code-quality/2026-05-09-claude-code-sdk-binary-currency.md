---
title: "Keeping the bundled Claude Code SDK binary current"
needs: [decision]
area: callback-box
---

The agent SDK (`@anthropic-ai/claude-agent-sdk`) bundles its own Claude Code binary as an optional npm dependency and ignores anything system-installed (no `$PATH` lookup, no `~/.local/bin/claude`). That binary is frozen at npm-install time, so a long-running server stays on whatever version of Claude Code was current when we last `npm install`-ed.

Today there's no process for refreshing it. The auto-updater on `~/.local/bin/claude` doesn't help — the SDK never looks there. Options:

- A scheduled task on the server that runs `npm install @anthropic-ai/claude-agent-sdk@latest` weekly, then restarts services.
- Tie SDK updates to deploys: `deploy.sh` re-resolves `claude-agent-sdk` to latest before rsync.
- Pin a specific SDK version in `package.json` and only bump deliberately (most explicit, lowest auto-update surface).

Related: [claude-agent-sdk-typescript#296](https://github.com/anthropics/claude-agent-sdk-typescript/issues/296) — the SDK's binary resolver tries musl before glibc on Linux. Worked around in `src/core/sdk-binary-path.ts` by passing `pathToClaudeCodeExecutable` ourselves.

## Update (2026-07-10)

How the drift actually happened in practice: the spec was `^0.2.128`, and semver
carets don't cross 0.x minors — when upstream moved 0.2 → 0.3 (SDK 0.3.x ↔ CLI
2.1.15x+), every `pnpm update` silently became a no-op and we rode 0.2.x to its
final release (0.2.141 ↔ CLI 2.1.141) while upstream reached 0.3.207 ↔ CLI
2.1.207. A scheduled `pnpm update` would NOT have fixed this — it respects the
caret. Any refresh process needs `pnpm update --latest` (or an explicit spec
bump) to cross 0.x minors, plus the global pnpm `minimumReleaseAge` (7 days)
means "latest" resolves to the newest week-old release.

Bumped to `^0.3.201` in the chat-steering worktree (2026-07-10); the 0.2→0.3
break surface was tiny (task-status union renamed `stopped`→`paused` in
`task_updated` patches). The decision this issue asks for — a recurring refresh
process — is still open.
