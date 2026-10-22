# 0. The agent forgets, and cannot read its tools
## Jan 30 – Mar 3
- Day four: a 217-line CLAUDE.md so each session stops rediscovering the project
- Two weeks later: a lint preset and a hook that lints every edit, feedback at edit time instead of commit time
- Feb 23: knowledge audits, because there was no way to tell if a guidance change reached the box agents
- Mar 3: doctests, because test files were code the agent had to reason about
- Exposed: the always-loaded file had reached 218 lines

Notes:
The earliest agent-facing gate is the per-edit lint hook (Feb 17). The doctest choice carried a second decision in June: TAP output with no color, because "the consumers of test runs are agents reading through a pipe".
