---
title: "Find prompt rules that a lint could enforce or back up"
workstream: unattached
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main session — reviewing which custom lint rules exist
---

Many rules in the instruction files are mechanical: "always use X, never
Y". A rule stated only in prose depends on the agent reading it, attending to
it, and remembering it in a long session. A lint enforces the same rule on
every commit, costs no context, and gives an error at the exact line.
Some prose rules could become lints and leave the prose shorter. Others
could keep a short prose line (the reason) with a lint behind it.

## Where to look

- `beebox/CLAUDE.md` and `beebox/code-style.md`;
- the root `CLAUDE.md`, nested `CLAUDE.md` files, and `frontend.md`;
- skills under `.claude/skills/`;
- the agent guide (`beebox/src/core/agent-guide/guide.md`), whose box-side
  rules could become checks in card validation or the box's pre-commit hook.

## Candidates seen while filing (verify each first)

Some may already be enforced by the preset, a third-party plugin
(`eslint-config-agent` and others), `pnpm layout-check`, or a test:

- ref parsing only through `parseRef` / `resolveRefPath`, never
  `path.resolve` or manual segment splitting on refs;
- timestamps through `getBoxTime` / `getBoxTimeISO`, not `new Date()` or
  `Date.now()`, in box-facing code;
- long timeouts through `startAwakeTimeout`, not a bare `setTimeout`;
- cross-process locks through `src/lib/file-lock.ts`, never `proper-lockfile`
  directly (a `no-restricted-imports` entry);
- no default parameters; at most two positional parameters; no barrel
  `index.ts` files;
- `console.log` only in CLI user-facing output;
- box side: `contains:` length and form, `First_Last` card names, refs with a
  leading `/`.

## How to judge each rule

- **Mechanical or judgment?** A lint fits a syntactic or structural rule. A
  rule that needs judgment ("prefer prose that serves several rows") stays
  prose.
- **Does the prose still earn its place after a lint lands?** If the lint's
  message carries the reason, the prose line may go entirely. If agents need
  the rule before they write code (to choose a design, not fix a line), keep
  a short line.
- **False-positive cost.** The repository rules allow one justified
  `eslint-disable-next-line` per true false positive. A rule that needs many
  disables is the wrong rule.
- **Which mechanism.** A `no-restricted-syntax` or `no-restricted-imports`
  entry, a code rule in `personal-vibe-check/rules/`, a `layout-check` rule,
  or a doctest.

Related: [architectural boundary lints](2026-07-24-architectural-boundary-lints.md),
[review all prompts](../docs-and-chores/2026-03-16-review-all-prompts.md).
