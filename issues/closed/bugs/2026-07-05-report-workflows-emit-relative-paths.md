---
title: "report workflows emit relative paths"
workstream: unknown
area: docs
filed-by: agent
discovered-in: main session — cleaning path leaks for the source-available release
resolution: implemented
---

**Closed (2026-07-05).** Resolved not with a workflow convention but with a
generator-agnostic backstop: `bin/path-leak-check.ts` (`pnpm path-leak-check`)
fails on any tracked file containing a real personal home path, and the
monorepo pre-commit hook runs it on every commit. A prompt convention had no
durable home — the leaking report came from an ad-hoc Workflow that committed
no generator, so the next such workflow would start from a blank slate; the
guard catches the leak regardless of how a report is produced. The one committed
report generator (`knowledge-audit.ts`) was already clean, and `bin/browse`
screenshot output — briefly suspected — turned out to be gitignored and never
reaches committed docs. See `bin/CLAUDE.md`.

Auto-generated audit reports leaked the author's home directory. The
2026-06-26 user-stories audit (`callback-box/docs/reports/`) carried ~105
absolute `Evidence:` paths like
`/Users/<user>/src/callback-worktrees/<wt>/callback-box/src/...`,
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
