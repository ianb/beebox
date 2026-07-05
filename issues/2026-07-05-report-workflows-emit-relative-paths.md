---
area: docs
filed-by: agent
discovered-in: main session — cleaning path leaks for the source-available release
---

# Report-generating workflows should emit repo-relative paths

Auto-generated audit reports leaked the author's home directory. The
2026-06-26 user-stories audit (`callback-box/docs/reports/`) carried ~105
absolute `Evidence:` paths like
`/Users/ianbicking/src/callback-worktrees/user-stories/callback-box/src/...`,
even though the report's own header claims "paths are relative to
`callback-box/`". The verifier agents pasted whatever `bin/browse` and file
reads handed them — absolute paths — and nothing relativized them.

Fixed in place (relativized the existing report; the `doc-graph.html`
generator that quoted it was also fixed to emit repo-relative `vscode://file`
links). But the *source* is an ad-hoc multi-agent Workflow with no committed
generator, so nothing stops the next such report from doing the same.

The durable fix is a **convention for report-generating workflows**: instruct
their agents to emit repo-relative paths (strip the checkout prefix), and/or
add a post-generation relativize pass. Worth folding into whatever prompt or
skill drives these audit workflows so a public repo doesn't accrue home-path
leaks each time one runs.

Related: the source-available release plan
(`callback-box/docs/plans/source-available-release.md`) records the leak
investigation and fixes.
