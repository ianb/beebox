# gstack review

Working through Garry Tan's [gstack](https://github.com/garrytan/gstack) — a collection of ~50 Claude Code "skills" (slash commands defined by `SKILL.md` files). Goal: absorb ideas, not copy wholesale. Identify what to experiment with, what to integrate, what to skip.

Local clone: `/tmp/gstack/` (shallow). Re-clone if gone.

## Status legend

- `?` — haven't looked yet (default)
- `learn` — want to read it / figure out what it actually is
- `try` — want to run as a one-off experiment
- `integrate` — want to adapt and adopt
- `reference` — competent but standard; refer to it when reviewing our own equivalent
- `skip` — not interested / not applicable
- `tbd` — read it, undecided

## Process

1. Triage pass → see [skills.md](skills.md) for the full index with my reactions.
2. Deep-dive notes go in `notes/<skill>.md` as we work through them.
3. When something becomes a real change to our project, link out to where it landed (CLAUDE.md, a skill of our own, etc.).

## Meta-patterns from gstack worth absorbing

These show up across many skills and matter more than any individual prompt:

1. **Evidence over prose** — screenshots, diagrams, before/after numbers, scorecards. Prompts demand artifacts, not summaries.
2. **Atomic-commit + re-verify loops** — `qa`, `design-review`, `ios-fix` commit each fix and re-test before moving on.
3. **Cross-model disagreement as signal** (`autoplan`) — treats Codex disagreeing as "taste decision, surface it" rather than averaging.
4. **Observe → codify** (`scrape` → `skillify`) — first run prototypes, subsequent runs cache, then user promotes it to a permanent skill.
5. **Hooks for guardrails** (`careful`) — destructive-command protection via PreToolUse, not prompt instructions. Prompt instructions can be ignored; hooks can't.
6. **Scope-restriction as state** (`freeze`) — actively blocks Edit/Write outside an allowed path. Bounded debugging session as a first-class mode.
