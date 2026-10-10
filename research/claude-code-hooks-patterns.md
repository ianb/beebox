# Claude Code hook patterns (reference note)

> **Naming note (2026-10-09):** agent instruction files in this repository and in boxes were renamed from `CLAUDE.md` to `AGENTS.md`. This document predates that and keeps the old name.


Source: https://buildingbetter.tech/p/i-read-the-claude-code-source-code
(a walkthrough of Claude Code's hook types from its source, read 2026-09).

Patterns worth drawing on when adding automation to `.claude/settings.json`:

- **PreToolUse**: rewrite risky commands before they run (for example force
  `--dry-run` onto `git push`), or auto-approve read-only commands by regex.
- **SessionStart**: inject repo state (branch, dirty files) and watch config
  files for changes.
- **PostToolUse**: scan written files for secrets or pattern-match audits
  before content lands.

The post also describes response fields beyond the documented ones
(`updatedInput`, `permissionDecision`, `additionalContext`, `once`, `async`,
`asyncRewake`). Treat those as claims: verify against the current Claude Code
docs before relying on them.

Disposition: later. Nothing here is adopted; the repo's hooks live in
`.husky/` and `.claude/settings.json`, and the root `CLAUDE.md` names when a
hook beats a skill.
