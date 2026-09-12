# Commit guards and provenance

## Home paths

`pnpm path-leak-check` scans tracked files and fails on real personal home
paths. Pre-commit always runs it. `ALLOWED_NAMES` contains deploy accounts and
obvious placeholders, not personal exceptions. Fix findings with repo-relative
or `~/` paths; never widen the allowlist.

## Personal blocklist

`pnpm commit-blocklist-check` scans staged additions against gitignored
`.commit-blocklist`; linked worktrees fall back to main's copy. No list is a
silent opt-in no-op. A malformed or tracked list fails closed. Copy
`.commit-blocklist.example` to configure it.

Rules are case-insensitive bare substrings, `re:` regular expressions, `!`
allows whose span contains a blocked span, or `file:<glob>` whole-file ignores
(`*` within a segment, `**` across `/`, no-slash globs by basename).
Diagnostics give `file:line` and rule number, never the matched value. The hook
covers additions only and `--no-verify` bypasses it; server-side protection is
needed for enforcement.

## Provenance and landing

`.husky/prepare-commit-msg` adds/replaces `Workstream` on worktree branches and
adds `Plan` only when exactly one plan declares the workstream. It skips squash,
detached HEAD, and main; errors warn and succeed. `.husky/commit-msg` parses the
trailer block and requires each `Issue` to match a public issue basename,
including closed issues. Values omit path and `.md`; private issues are never
searched. A miss blocks.

Query with `pnpm commit-provenance --workstream|--plan|--issue <name> [--main]`.
Root `pnpm install` activates hooks through relative `core.hooksPath=.husky/_`.

`bin/land [branch]` resolves main from the common Git directory and merges
`--no-ff --no-edit`. It requires clean main on `main` and a branch containing
current main. With no argument a worktree lands itself; main selects only one
unambiguous candidate. `--list` and `--dry-run` preview. A refusal after prior
verification means main moved, so merge main and reverify in the worktree. Main
post-merge hooks decide deployment from changed paths; worktree commits do not
deploy.

Background: `beebox/docs/implemented-plans/commit-provenance-trailers.md`.
