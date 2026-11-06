---
title: "InteractiveChat exceeds the frontend function length rule"
workstream: unattached
area: beebox
labels: [lint, chat]
filed-by: agent
discovered-in: "worktree-point-to-comment — frontend lint, 2026-11-05"
---

The frontend lint command reports `max-lines-per-function` on `InteractiveChat`
in `src/components/chat/everywhere/InteractiveChat/shell.tsx`: 151 lines against
the 150-line limit. This file is unchanged in the point-to-comment worktree;
changed-file lint passes. Extract a coherent part of the shell so full lint
passes without changing or suppressing the rule.
