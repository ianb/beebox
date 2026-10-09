---
name: knowledge-audit
description: Test what a real agent learned from its guidance. Box audits cover box-loaded guidance (box CLAUDE.md, generated agent guide, schema instructions, prompts, rules); dev audits (`--dev`) cover what a Claude Code session in this checkout learns from the repo's AGENTS.md files, skills, and docs. Use after changing either surface.
---

# Knowledge audits: verifying what agents actually know

An audit prompts a real agent, records its tool use, and checks its
response. It tests what the agent knows after loading guidance, not code.
Definitions are in `beebox/src/dev/knowledge-audits.yaml`. Fields, knowledge
levels, prompt style, and failure patterns are in
`beebox/docs/testing/knowledge-audits.md`; read it before writing an entry.

## When to run

- Immediately after adding or editing audit entries, filtered to those
  entries. A never-run audit is unverified in both directions: the agent may
  fail it, or the audit itself may be wrong.
- After changing what a box agent loads (box CLAUDE.md, agent guide, schema
  `instructions`, box prompts or rules), or, with `--dev` (Claude only, no
  box), this repo's AGENTS.md files, skills, or the docs they point to.
- Monthly otherwise, for drift.

## Running

From `beebox/`:

```bash
pnpm knowledge-audit run --box ~/src/box-worktrees/<worktree>/test1 [--filter <tag-or-id>] [--engine claude|codex]
pnpm knowledge-audit run --dev [--model <id>] [--filter <tag-or-id>]
pnpm knowledge-audit list
```

Pass `--box` as an absolute or `~/` path to a standalone box outside any repo:
in a managed worktree, its isolated clone; in the main checkout,
`~/src/boxes/test1` (also the default when `--box` is omitted). Never pass a
bare name such as `test1`: it resolves inside the monorepo. The runner resets
and cleans the box between tests, so `src/dev/lib/box-guard.ts` refuses a box
nested in another repo or with uncommitted changes. When the guard refuses,
fix the path or the box; do not work around the guard.

## Recording results

Reports in `src/dev/reports/` are gitignored. The durable record is a hand-added
`# Status (YYYY-MM-DD):` comment next to the test section in
`knowledge-audits.yaml`: pass/fail counts and notable failure patterns. When
a test fails, prefer changing the docs or prompts over weakening the test.
