---
title: "Codex skill mirrors in the main checkout are stale copies from July, and the generator has been failing there ever since"
workstream: unattached
area: monorepo
priority: important
labels: [codex, skills, tooling]
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: main session — editing the launch-worktree-session skill and checking whether Codex would see the change
---

> **Fixed 2026-08-24.** The refusal is kept — a native Codex skill at a tracked
> skill's name is still never overwritten, and the test of that name still
> proves it. What changed is the failure mode: it now **warns and skips that one
> entry** instead of throwing, so a single unexpected directory can no longer
> abort every later skill and the AGENTS.md mirrors after it.
>
> The main checkout is repaired: 0 symlinks → **21**, and generation now runs to
> completion ("wrote 18 AGENTS.md mirror(s) and 21 skill link(s)") instead of
> dying on the first entry. `launch-worktree-session`'s mirror went from a 6,861-byte
> July copy to byte-identical with the tracked 15,468-byte skill.
>
> **Deliberately not done:** auto-replacing a non-symlink. That was the first fix
> attempted, and the test named "refuses to overwrite an existing native Codex
> skill" showed the refusal was a considered decision, not an oversight — so
> overriding it was not the agent's call to make.
>
> **Residual:** three entries remain real directories — `bbx-prompt-review`,
> `codex`, `skill-creator` — none of which is a tracked Claude skill any more.
> The loop only manages tracked names, so it leaves them, and the cleanup pass
> only removes stale *symlinks*. A Codex session there still sees July copies of
> skills that no longer exist. Worth a follow-up decision rather than a silent
> delete.

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
and the base-ref warning added today. `finish`, `browse`, `bbx-plan`,
`bbx-migration` and the rest are equally stale.

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
