---
title: "Generated box-docs files do not name their source, so sessions edit the output"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261110-003006
---

`beebox/box-docs/*.md` is gitignored generated output. Three sessions in three days edited a file there first, and found out only when `git status` or `git check-ignore` showed no change. The sources are spread across `beebox/docs/box/`, schema `instructions`, `beebox/src/core/views/doc/*.ts`, and `beebox/src/core/docs-gen/package-docs/`.

The retrospective added one sentence to `beebox/AGENTS.md` (Source Layout) that names the sources. Two of the sessions asked for a header line in each generated file that names its source module. Box agents read these files too, so the header should be one a box agent can ignore (for example an HTML comment), or the generator should write the map to a file only the dev checkout has.

Evidence: `workspaces/20261110T022656Z-implemented.md`, `chat-show-me-links/20261109T203849Z-implemented.md`, `box-feedback-bugs/20261109T202928Z-implemented.md`.
