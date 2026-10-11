---
title: "doc-check --fix leaves backticked paths and moved files' own links broken after a plan or issue move"
workstream: unattached
area: docs
labels: [doc-check]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

`beebox/src/dev/doc-check/link-repair.ts` rewrites Markdown links to `.md`
targets by unique basename. It does not rewrite backticked plan paths in
prose, source comments, schedule prompts, or `knowledge-audits.yaml`, and it
does not re-depth a moved issue's own `../` links to non-`.md` targets. Each
plan move or issue close then needs a hand grep.

Coding feedback: hq-always/20261010T163515Z-landed.md,
agents-md/20261009T225436Z-landed.md, journey-walks-oct/20261009T042211Z-landed.md,
journey-walks-oct/20261009T001800Z-review-adjudicated.md,
user-facing-language/20261009T124943Z-landed.md. The finish agent now says to
grep (`.claude/agents/finish.md` step 5); a move-aware rewrite would remove
that step.
