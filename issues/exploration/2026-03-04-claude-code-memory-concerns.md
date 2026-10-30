---
title: "Claude Code Memory Concerns"
workstream: unknown
area: monorepo
---

Auto-memory (`~/.claude/projects/<path-hash>/memory/`) is problematic:

- Path-hash-based and machine-specific -- not portable across machines
- Not version-controlled, easily lost if repo moves
- Custom subagents don't inherit CLAUDE.md or `.claude/rules/` (only built-in subagents do)
- No setting to relocate memory into the project repo
- Open feature request: [anthropics/claude-code#25739](https://github.com/anthropics/claude-code/issues/25739)

Durable project knowledge should go in repo files (AGENTS.md, docs/), not auto-memory.

Re-reviewed 2026-10-30: the stance (durable knowledge goes in repo files) is already practice. To settle: check whether current Claude Code offers a memory-directory setting and the status of anthropics/claude-code#25739; if neither changes the stance, close as wontfix.
