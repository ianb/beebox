# Vendored — do not hand-edit

This skill is vendored **verbatim** from Anthropic's official skills repo:

- Source: https://github.com/anthropics/skills — `skills/skill-creator/`
- Pulled: 2026-06-20 at commit `5754626`
- License: Apache 2.0 (see `LICENSE.txt` in this directory)

It ships a Python eval/benchmark harness (`scripts/*.py`, `eval-viewer/`)
that requires Python. We vendored it as-is rather than adapting (cf. the
`codex` skill, which is *adapted*). To update, re-pull from upstream rather
than editing in place; local edits will be lost on the next pull.
