---
title: "Public comparison pages claim adoptions that never shipped"
workstream: unattached
area: site
filed-by: agent
discovered-by: agent
discovered-in: worktree-acknowledgements — verifying credit candidates against the tree
priority: normal
---

Two pages under `site/docs/compared/` state that Bee Box adopted ideas that
have no landing in the repository.

- `site/docs/compared/gstack.md` says we adopted gstack's hook-enforced
  destructive-command guardrail. No PreToolUse hook has ever existed in
  `.claude/settings.json`, and `research/gstack/skills.md` marks `careful`
  as skip. The same page says we "had begun porting" the cross-model review
  skill; that port shipped as `.claude/skills/cross-model/`.
- `site/docs/compared/openclaw.md` says we "adapted" OpenClaw's signature
  emoji as an identity element. Only an open issue exists; no schema field or
  UI was built.

Fix: reword both pages to describe what shipped. The acknowledgements file
(see the attribution issue) is the record of what was actually adopted; the
comparison pages should not claim more than it does.
