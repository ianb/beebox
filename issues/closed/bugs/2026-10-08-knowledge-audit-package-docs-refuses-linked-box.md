---
title: "Knowledge audits with `should_read` into package docs crash on a worktree box clone"
workstream: speech-instructions-attr
resolution: implemented
area: beebox
labels: [knowledge-audit, testing]
filed-by: agent
discovered-in: speech-instructions-attr
---

Closed by 8a75acc36: `ensureAuditPackageDocs` now accepts a `node_modules/beebox` link that resolves to the running engine's PACKAGE_ROOT; other symlinks are still refused.

On a managed worktree's box clone (`~/src/box-worktrees/<name>/test1`),
`node_modules/beebox` is a symlink to the worktree's `beebox/` package. Any
audit whose `should_read` names a file under `node_modules/beebox/box-docs/`
stops the whole run:

```
UnsafeAuditFixturePathError: Knowledge-audit fixture path crosses a symbolic link: node_modules/beebox/box-docs/README.md
```

The guard is `ensureAuditPackageDocs` in
`beebox/src/dev/lib/test-runner/runner/fixtures.ts`. It refuses to generate
package docs through the symlink, which is correct for writes, but the run
had already regenerated those docs ("Regenerating docs in …"), so nothing
needs to be written. Reproduce with
`pnpm knowledge-audit run --box ~/src/box-worktrees/<name>/test1 --filter chat-voice-hard-override`.

Expected: when the docs already exist at the linked package, skip
generation and run the test; at minimum fail that one test instead of the
whole run.
