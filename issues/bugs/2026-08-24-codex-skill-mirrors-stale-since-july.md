---
title: "Codex skill mirrors in the main checkout are stale copies from July, and the generator has been failing there ever since"
workstream: unattached
area: monorepo
priority: important
labels: [codex, skills, tooling]
filed-by: agent
discovered-by: agent
discovered-in: main session — editing the launch-worktree-session skill and checking whether Codex would see the change
---

In the main checkout, **every entry under `.agents/skills/` is a real directory
holding a stale copy, not a symlink** — 15 of 15, all dated **2026-07-06**.

`bin/generate-agents-md.ts:256-266` symlinks each tracked
`.claude/skills/<name>/` into `.agents/skills/<name>`, and **throws** rather
than overwrite anything that is not already the expected symlink:

```ts
} else if (!existing.isSymbolicLink() || readlinkSync(path) !== target) {
  throw new Error(`refusing to overwrite existing Codex skill path: .agents/skills/${name}`);
}
```

Verified by running it in main:

```
Error: refusing to overwrite existing Codex skill path: .agents/skills/browse
```

It throws on the **first** stale entry, so the whole generation aborts. Nothing
after that point runs, and nothing reports it — the failure is only visible if
someone runs the generator by hand.

## What it costs

A Codex session reading skills from the main checkout gets a seven-week-old
copy of every skill. Measured on the one that prompted this:

| | bytes |
|---|---|
| `.claude/skills/launch-worktree-session/SKILL.md` | 15,468 |
| `.agents/skills/launch-worktree-session/SKILL.md` | 6,861 |

Less than half. Everything added since 2026-07-06 is invisible to Codex there —
including the agent/model-choice guidance, the routing-before-creating section,
and the base-ref warning added today. `finish`, `browse`, `cb-plan`,
`cb-migration` and the rest are equally stale.

**Worktrees are probably fine**: a fresh worktree has no `.agents/` yet, so the
generator symlinks cleanly at spin-up. That is also why this stayed hidden —
the launched Codex sessions people actually watch are worktree sessions, and
they work.

## The guard is right; its failure mode is not

Refusing to clobber a hand-authored Codex skill is correct — that is a real
thing someone might write. The defects are around it:

- **It throws instead of skipping**, so one stale entry stops every later skill
  *and* whatever the generator does afterwards.
- **Nothing detects the condition.** These have been stale since July with no
  warning anywhere; the only symptom is a Codex session quietly working from old
  instructions, which looks like the agent being dense rather than a tooling bug.
- **There is no repair path.** Nothing distinguishes "a stale generated copy
  from before symlinks" from "a deliberate hand-authored skill", and nothing
  offers to fix the first.

## Fix directions

- **Distinguish and self-heal.** A generated copy could carry a marker (the
  AGENTS.md mirrors already carry generated framing), so the generator can
  replace its own past output while still refusing anything hand-written.
- **Warn and continue** rather than throw, so one bad entry cannot silently
  cost every other skill.
- **Surface it.** If Codex sessions depend on these, a stale mirror deserves to
  be as visible as a failed install.

Immediate unblock is a one-liner (`rm -rf .agents/skills` then regenerate), but
that is a workaround: the next stale directory reproduces it exactly.
