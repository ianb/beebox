---
title: "Knowledge-audit read checks miss `cd dir; cat file` and `$VAR/file` reads"
workstream: unattached
area: beebox
labels: [knowledge-audit]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agents-md — auditing the box AGENTS.md migration
---

A `should_read` check fails when the agent reads the file through a Bash
command that the matcher does not resolve. Two forms seen on 2026-10-09 in
`views-render-test-command` (expects `node_modules/beebox/box-docs/views.md`):

- `cd …/node_modules/beebox/box-docs; cat views.md card-view.md`
- `B=node_modules/beebox/box-docs; cat $B/views.md`

Both runs read the document, as the reports' Bash lists and the agents'
answers show, and both were scored as failures. Three runs of that audit on
one box gave one pass and two of these false negatives, so a single red result
says little about what the agent knew.

The shell commands become `filesRead` in the runner
(`beebox/src/dev/lib/test-runner/`, for Codex `runner/codex-audit.ts`
`shellCommandConsultsFiles`). Resolving a leading `cd` and simple
`NAME=value` assignments inside one command would cover both forms. Not
checked: whether the Claude runner path uses the same matcher.
