---
name: knowledge-audit
description: Test what a real box agent learned from box-loaded guidance such as a box CLAUDE.md, generated agent guide, schema instructions, prompts, or rules. Use after changing those surfaces; dev-repo CLAUDE.md files and skills are invisible to box agents and cannot be audited this way.
---

# Knowledge audits: verifying what agents actually know

An audit prompts a real box agent, records its tool use, and checks its
response. It tests what the agent knows after loading box guidance, not code.
Definitions are in `beebox/src/dev/knowledge-audits.yaml`. Fields, knowledge
levels, prompt style, and failure patterns are in
`beebox/docs/testing/knowledge-audits.md`; read it before writing an entry.

## When to run

- Immediately after adding or editing audit entries, filtered to those
  entries. A never-run audit is unverified in both directions: the agent may
  fail it, or the audit itself may be wrong.
- After changing what a box agent loads: a box CLAUDE.md, the generated agent
  guide, schema `instructions`, box prompts or rules. This repo's CLAUDE.md
  files and skills never reach a box agent, so audits cannot observe them.
- Monthly otherwise, for drift.

## Running

From `beebox/`:

```bash
pnpm knowledge-audit run --box ~/src/box-worktrees/<worktree>/test1 [--filter <tag-or-id>] [--engine claude|codex]
pnpm knowledge-audit list
```

Pass `--box` as an absolute or `~/` path to a standalone box outside any repo:
in a managed worktree, its isolated clone; in the main checkout,
`~/src/boxes/test1` (also the default when `--box` is omitted). Never pass a
bare name such as `test1`: it resolves inside the monorepo. The runner runs
`git reset --hard` and `git clean -fd` in the box between tests, so
`src/dev/lib/box-guard.ts` refuses a box nested in another repo (the reset
would hit that repo) and a box with uncommitted changes. When the guard
refuses, fix the path or the box; do not work around the guard.

## Recording results

Reports in `src/dev/reports/` are gitignored. The durable record is a
`# Status (YYYY-MM-DD):` comment you add by hand in `knowledge-audits.yaml`
next to the test section: pass/fail counts and notable failure patterns. When
a test fails, prefer changing the docs or prompts over weakening the test.
