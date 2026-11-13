---
title: "bin/doc-move leaves link text and prose paths stale; bin/issues close leaves its rewrites unstaged"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261113-003305
---

A move rewrites link targets but not everything that names the old path:

- Link text that spells the old path (a `plans/` label) stays stale; a
  session fixed it with sed.
- A plan path named in prose (a workstream `task.md`) is reported, not
  rewritten.
- `bin/issues close` rewrote a path in a test comment and left the edit
  unstaged beside the staged rename. In a worktree shared by parallel workers,
  the staged rename broke another worker's unrelated commit at doc-check.

Wanted: rewrite link text that equals the old path, and have `issues close`
either stage all its rewrites together or stage nothing and print the paths to
add.

Evidence: `chat-presence/20261113T015356Z-landed.md`,
`canvas-brushes/20261112T132713Z-landed.md`,
`schema-watcher-flake/20261112T135353Z-landed.md`,
`web-guidance-scan/20261111T100011Z-implemented.md`, and the retrospective
watch item `issues-close-staging-and-references`.
