---
title: "beebox/docs/box/whats-new.md conflicts when two branches add entries on the same day"
workstream: unattached
area: beebox
labels: [finish, merge]
filed-by: agent
discovered-in: worktree-retrospective — retrospective 20261119-010700
---

`bin/finish-preflight` merges `main` and resolves conflicts in files it has a
content rule for (`CONTENT_RULES` in `bin/finish-preflight-merge.ts`:
`context-history.yaml` and `migrations.ts`). `beebox/docs/box/whats-new.md`
has no rule. Each user-facing branch adds one dated line under the intro,
newest first, so two branches landed on the same day touch adjacent lines and
the merge stops on a conflict that is always "keep both lines".

Evidence (coding-feedback entries):

- `ambient-callouts-only/20261118T224441Z-landed.md` — merge conflicted on
  whats-new.md; the commit hook then ran a full typecheck in the background.
- `card-source-chips/20261118T222816Z-landed.md` — merge conflicted in
  whats-new.md (adjacent entries), resolved by keeping both.

A rule in the style of `mergeLedger` would do it: when both sides kept every
base line and only added `- YYYY-MM-DD **Kind**: …` lines, emit the union sorted
newest first. An edited or removed line stays a person's call.
