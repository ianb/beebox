# No transform to mangle
## Supporting: two header comments from the Codex mirror generators
```ts
 * Content is copied VERBATIM (header/preamble prepended, zero substitution).
 * A committed AGENTS.md produced by find-replace rotted for a month and was
 * removed in 872450eb; this generator kills both failure modes by
 * construction: no transform to mangle, and regeneration at every worktree
 * spin-up… instead of a committed copy that drifts. AGENTS.md is gitignored
 * at every level — the generator refuses to overwrite any AGENTS.md that is
 * tracked.                                     (generate-agents-md.ts, now retired)
```

```ts
 * Also writes .codex/hooks.json… the hand-written file it replaces invoked
 * `$CLAUDE_PROJECT_DIR/...`, a variable only Claude Code sets. Under Codex it
 * expanded to `/beebox/...`, so the lint hook exited 127 on every edit —
 * reported as "Hook failed" and, worse, silently linting nothing.
 *                                              (bin/generate-codex-agents.ts)
```

Notes:
The first attempt (a committed AGENTS.md) was removed on May 26 as "a stale partial duplicate". The second survived because it has no transform and is never committed. On Oct 9 the generator stopped writing mirrors at all: every CLAUDE.md was renamed to AGENTS.md, which both agents read natively, and doc-check now refuses any CLAUDE.md in the repo. Three designs in five months for one need. Before that, the October review still found drift in the main checkout: three stale real directories the link generator did not prune.
