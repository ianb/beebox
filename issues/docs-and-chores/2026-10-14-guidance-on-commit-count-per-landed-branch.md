---
title: "No guidance on how many commits a workstream lands with"
workstream: unattached
area: docs
labels: [dev-process]
filed-by: agent
discovered-by: Ian
discovered-in: main session — 2026-10-14
---

Nothing says how many commits a workstream should land on `main`. Root
`AGENTS.md` says only "Commit verified work at good checkpoints without
asking". The finish skill (`.claude/skills/finish/SKILL.md`) and the finish
agent (`.claude/agents/finish.md`) say nothing about commit count, squashing,
or the commits the finish run makes itself.

## Measured (merges to `main`, 2026-10-07 to 2026-10-14)

20 branch merges. Commits per merged branch:

- 1 commit: 5 merges
- 2–3 commits: 12 merges
- 8 and 11 commits: `finish-tooling`, `siri-app-intents`
- 31 commits: `flaky-tests` (2026-10-12). It is one commit per doctest fix,
  per issue close, and per `careful.txt` change, made within about two
  hours.

## Trade-offs

- **Many small commits:** each one is easy to revert or bisect, and the
  `Issue:` trailers stay precise. But `main`'s history gets long, and
  reading what a workstream did means reading 31 subjects.
- **Few large commits:** history reads as one change per workstream. But a
  revert takes out unrelated fixes with the bad one, and one commit can
  carry several issues.
- The merge commit already groups a branch. `git log --first-parent main`
  shows one line per workstream, whatever the branch holds.

## Open questions

- Is the guidance a target (for example, one commit per independently
  revertable change) or a limit?
- Should the finish agent squash or regroup before landing? It runs headless
  and merges only on a clean path, so a rewrite of history there is a new
  risk.
- Do issue closes, plan reconciles, and `careful.txt` edits get their own
  commits, or ride with the change that caused them?
- Where it goes: root `AGENTS.md` (applies to all commits) or the finish
  skill (applies at landing).
