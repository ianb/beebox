---
name: knowledge-audit
description: Test what a real box agent learned from box-loaded guidance such as a box CLAUDE.md, generated agent guide, schema instructions, prompts, or rules. Use after changing those surfaces; dev-repo CLAUDE.md files and skills are invisible to box agents and cannot be audited this way.
---

# Knowledge audits: verifying what agents actually know

A pointer skill: what the harness is and when to reach for it. Test
structure, recording results, and interpreting failures live in
`beebox/docs/knowledge-audits.md`.

## What it is

Tests that prompt a real box agent, watch its tool use, and check its
response — not unit tests of code, tests of what an agent *knows* after
reading CLAUDE.md/schemas/prompts. Definitions in
`beebox/src/dev/knowledge-audits.yaml`; harness in
`beebox/src/dev/knowledge-audit.ts` + `src/dev/lib/`.

## When to run

- Immediately after adding or editing audit entries — filtered to just those
  (`--filter <tag-or-id>`). A never-run audit is unverified in both
  directions.
- After touching what a box agent actually loads — a box CLAUDE.md, the
  generated agent guide, schema `instructions`, box prompts/rules. (Not
  dev-repo guidance: this repo's CLAUDE.md and skills never reach a box
  agent's context, so audits can't observe them.)
- Monthly-ish, for slow drift.

## Running

From `beebox/`:

```bash
pnpm knowledge-audit run --box ~/src/boxes/test1 [--filter <tag-or-id>]
pnpm knowledge-audit list
```

**`--box` must be an absolute path (or `~/…`) to a standalone box outside this
repo** — e.g. `~/src/boxes/test1`, not a bare name like `test1`. A box guard
(`src/dev/lib/box-guard.ts`) refuses a box nested inside another git repo
(such as one accidentally created inside the monorepo): the harness resets
box git state between tests (`git reset --hard` + `git clean -fd`), and
against a nested box that would hit the *enclosing* repo instead — discarding
uncommitted monorepo work and leaking the parent's CLAUDE.md into the box.
The guard fails closed with remediation text; it's a safety net, not a
substitute for passing a real absolute path.

## Reading results

- Console output shows pass/fail per audit as it runs.
- A full report lands in `src/dev/reports/` (gitignored, ephemeral working
  artifact).
- The **durable record** is a `# Status (YYYY-MM-DD):` comment you add by
  hand in `knowledge-audits.yaml` next to the relevant test section —
  pass/fail counts and notable failure patterns.
- When fixing a failure, prefer changing docs/prompts over changing the
  test — the test asserts an expectation about agent behavior.
