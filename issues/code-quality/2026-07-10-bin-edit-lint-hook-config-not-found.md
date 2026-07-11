---
title: "PostToolUse lint hook errors on every bin/ edit — ESLint can't find a config"
area: router
filed-by: agent
discovered-in: worktree-issue-browser — editing bin/router-issues.ts
---

Every Edit/Write to a file under `bin/` makes the PostToolUse lint hook report
a hard ESLint error: "ESLint couldn't find an eslint.config.(js|mjs|cjs) file."
`bin/eslint.config.mjs` exists (deliberately empty, to silence exactly this
hook), but ESLint v9 resolves flat config from the **cwd**, not from the linted
file's directory — the hook apparently runs from the repo root, which has no
config, so the empty `bin/` config is never found and the hook emits a full
error banner on every single `bin/` edit. That's real agent-context noise on a
directory agents edit routinely (router work).

Candidate fixes, pick one: run the hook's eslint with `--config` resolved from
the target file's directory (or cwd into it); add a root `eslint.config.mjs`
that maps `bin/**` to the empty config and other paths to their packages'
presets; or use ESLint's config-lookup-from-file flag once stable. The empty
`bin/eslint.config.mjs` header comment says it exists to silence this hook —
it currently fails at that job.
