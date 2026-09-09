---
title: "Architectural boundary lints (openclaw-style channel-agnostic enforcement)"
workstream: openclaw-security-lints
area: beebox
labels: [lint, openclaw-borrow]
filed-by: agent
discovered-in: worktree-openclaw-security-lints — surveying openclaw's custom lint walkers
needs: [design]
priority: normal
---

openclaw enforces architectural boundaries with a standalone TS-AST walker
(`scripts/check-channel-agnostic-boundaries.mjs`, ~400 lines): a designated
"core" set of directories may not import a channel adapter module, reference a
per-channel config path (`config.channels.<name>`), compare against a channel-id
string literal (`x === "slack"`), or assign one to a `channel` field. It also
bans hardcoding a magic sentinel literal (a specific emoji) instead of the named
constant. Four sub-rules, each per-file, allowlist-gated.

The generalizable ideas worth stealing:

- **A layer must stay abstract over its adapters/plugins** — "core may not name a
  specific adapter." 
- **Reverse-dependency ban** — core must not import from adapter dirs.
- **Magic-literal ban** — a sentinel value must go through a named constant.

The technique is a plain `import ts from "typescript"` walker wired into the lint
step — nothing oxlint-specific. In *our* stack most per-file boundary checks are
expressible as ESLint `no-restricted-imports` / `no-restricted-syntax` with
`files:` overrides (the preset already uses ~22 such selectors), so we likely
wouldn't need a standalone walker unless the check is genuinely cross-file.

**Why this is exploration, not a task:** the value is entirely in *which boundary
we choose to protect*, and we haven't defined ours. Candidate boundaries to weigh:
frontend must not import backend internals; a schema/cards core that must stay
abstract over specific card types; the reactor/webapp core vs. its handlers;
the dying `view:` scheme. Needs a design pass to name a boundary that actually
keeps getting violated before writing any rule — an unused boundary lint is just
ceremony.

Related: the box-content linting track in
[../features/2026-07-24-box-content-card-linting.md](../features/2026-07-24-box-content-card-linting.md)
and the dev-repo hooks in
[../code-quality/2026-07-24-security-precommit-hooks.md](../code-quality/2026-07-24-security-precommit-hooks.md).
