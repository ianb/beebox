# Card validation hooks

How card validation reaches agents and commits inside a box. Installed
during `cb init` by `src/core/install-validation-hooks.ts`; the hook
commands embed the absolute path to the installing `bin/cb` so they don't
depend on the user's PATH.

`cb validate` checks all cards, a list of files, or `--staged`. Cards also
validate on load (`src/core/card-io.ts`).

Three hooks are installed per box:

- `.claude/settings.json` — PostToolUse hook running `cb validate --hook`
  after Edit/Write/MultiEdit. On a card path with errors it exits 2 with
  the error on stderr so Claude Code surfaces it to the agent (warning,
  not blocking).
- `.git/hooks/pre-commit` — runs `cb validate --staged`; blocks commits
  that include cards failing validation.
- `.git/hooks/post-commit` — fires `cb validate --urls --urls-since
  HEAD~1` in the background (non-blocking) to HEAD-check *external*
  http(s) URLs the first time they appear. Warning-only, never gates;
  verdict cache is gitignored at `.callback-box/url-checks.json`. The
  synchronous lint never touches the network — only this pass does. See
  `docs/implemented-plans/external-url-validation.md`.

Format reference: `docs/cards-as-markdown.md`; design history and migration phases: `docs/implemented-plans/cards-as-markdown-rfc.md`.
Per-schema migrators: `scripts/migrate/*.ts` + `scripts/migrate/_warnings.ts`
(noisy-mode field-loss detection).
