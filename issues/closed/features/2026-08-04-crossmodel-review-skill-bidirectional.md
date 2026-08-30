---
title: "Make the cross-model review skill bidirectional (rename `codex` → `cross-model`, review with the *other* model family)"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder noticed while landing codex worktree parity
resolution: implemented
---

> **Closed 2026-08-04** — implemented in the `cross-model-review-skill` worktree.
> `.claude/skills/codex/` → `.claude/skills/cross-model/`, branching in prose on
> which model runs it. The new Codex→Claude half is
> `claude -p --model opus --effort high --setting-sources user
> --no-session-persistence --tools "Read,Grep,Glob"`, prompt piped from a file,
> diff pre-materialized to `scratch/`. Plan mode defaults to `--model fable`
> (approach-level judgment) while diff review stays on Opus.
>
> Two things the build turned up that the design didn't anticipate, both fixed:
> a nested `claude -p` inside a worktree fires the project `SessionEnd` hook and
> **deletes that worktree** (it did, once, during this work), and
> `pgrep -x claude` — the liveness guard in `bin/workstreams sweep` — misses
> essentially every live session because pgrep matches the accounting name,
> which is the Claude Code *version string*. See `bin/CLAUDE.md` → "Codex
> worktree sessions".

The `codex` skill (`.claude/skills/codex/`) runs OpenAI's codex CLI to get an
**independent cross-model review** — a different model family than Claude, so it
catches blind spots a same-model self-review structurally cannot (root CLAUDE.md
mandates it for anything bigger than a small-scope bug fix). But it is
one-directional: it only does **Claude → Codex**. Now that codex workers exist
(`bin/launch-worktree-session --agent codex`) and skills are mirrored to them, a
codex worker invoking it (`$codex`) is **codex reviewing codex** — same blind
spots, but it *looks* like the mandated cross-model check, so it manufactures
false confidence. The CLAUDE.md line "get a Codex review before done" is likewise
wrong for a codex author — its cross-model reviewer is Claude.

## Chosen direction (boxholder, 2026-08-04): one bidirectional skill

Rename the `codex` skill to **`cross-model`** and make it review with the *other*
model family relative to whoever runs it:

- **From Claude** → run `codex` (Codex reviews Claude's work). [today's behavior]
- **From Codex** → run `claude -p` headless (Claude reviews Codex's work). [new]

Why this beats just disabling `$codex` from codex sessions: it makes the whole
mechanism symmetric, keeps ONE source of truth for "get an outside review," and
lets the CLAUDE.md guidance become model-agnostic instead of Claude-only.

## Design notes

- **No runtime host-detection needed.** The running agent already knows what it
  is, so the skill just branches in prose: "if you are Claude, review with Codex;
  if you are Codex, review with Claude." Invoked `/cross-model` (Claude) /
  `$cross-model` (Codex).
- **This supersedes the "don't mirror the codex skill" guard.** Instead of
  special-casing the skill mirror in `bin/generate-agents-md.ts`, mirror
  `cross-model` normally and let it be model-aware. (No exclusion list to
  maintain.)
- **Keep the hard-won Claude → Codex invocation notes** already in the skill
  (model throttling → `-m gpt-5.5`, foreground-only, orphan-process cleanup,
  fenced prompts). Those stay for that direction.
- **Add a known-good Codex → Claude invocation:** `claude -p --model <opus|sonnet>
  "<fenced review prompt>"`, read-only, foreground; work out its own gotchas
  (auth, non-interactive flags, read access to the worktree diff). It is the
  mirror image of the codex direction.
- **Update the CLAUDE.md guidance** from "Get a Codex (cross-model) review …" to a
  model-agnostic "Get a cross-model review (`/cross-model`; `$cross-model` from
  Codex) …", and drop the now-unneeded "your reviewer is Claude, not Codex" note
  from the generated Codex preamble (`bin/generate-agents-md.ts` `rootPreamble`) —
  the skill handles it.
- **No recursion risk:** the spawned reviewer (codex or `claude -p`) does not
  re-invoke `cross-model`; it just reviews and returns.
- **Rename mechanics:** kebab-case skill dir `cross-model`. Grep for `/codex`,
  `codex skill`, `.claude/skills/codex` references (root CLAUDE.md, bin/CLAUDE.md,
  the bbx-plan skill, any docs) and update. Keep a one-line note that it was
  adapted from gstack's `/codex` skill.

## Related

- `beebox/docs/implemented-plans/codex-worktree-sessions.md` — the codex
  worktree feature this completes the review story for.
- The skill-mirroring landed with the codex finish/merge parity change
  (`bin/generate-agents-md.ts`, `bin/launch-worktree-session`).
