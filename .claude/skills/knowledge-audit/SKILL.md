---
name: knowledge-audit
description: Explains callback-box's knowledge-audit harness — YAML-defined tests that prompt a real box agent and check what it actually knows. Use after touching what a BOX agent loads — a box CLAUDE.md, the generated agent guide, schema instructions, or box prompts/rules — to verify agents absorbed it. (Dev-repo guidance like this repo's CLAUDE.md or .claude/skills/ is invisible to box agents; audits can't test it.) Triggers include "knowledge audit", "did the agent absorb this doc", "audit the guidance", "test what the agent knows", "run the knowledge audits". Full guide in callback-box/docs/knowledge-audits.md.
---

# Knowledge audits: verifying what agents actually know

A pointer skill: what the harness is and when to reach for it. Test
structure, recording results, and interpreting failures live in
`callback-box/docs/knowledge-audits.md`.

## What it is

Tests that prompt a real box agent, watch its tool use, and check its
response — not unit tests of code, tests of what an agent *knows* after
reading CLAUDE.md/schemas/prompts. Definitions in
`callback-box/src/dev/knowledge-audits.yaml`; harness in
`callback-box/src/dev/knowledge-audit.ts` + `src/dev/lib/`.

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

From `callback-box/`:

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
