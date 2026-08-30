---
title: "Make bbx-debug's circuit-breaker mechanical — a hook that counts repeated failures"
workstream: elixir-skills-review
area: beebox
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
next-action: discuss
---

`.claude/skills/bbx-debug/SKILL.md:150` has a 3-fix circuit-breaker: after three
failed fixes, stop patching and treat it as an architecture problem. It's prose
asking the agent to notice it's in a loop — which is exactly the thing a looping
agent is bad at. The same file's "Common rationalizations" table exists because
we know the agent talks itself past the breaker.

A hook can just count.

## The shape

From [research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/enforcement-and-hooks.md),
a `PostToolUseFailure` hook on Bash that keys on the failing command and
escalates:

- **Attempt 1** — silent.
- **Attempt 2** — inject "repeated failure", ask the model to diff this error
  against the previous one.
- **Attempt 3+** — inject a consolidated error history from its own log plus a
  fixed recovery instruction: stop retrying, re-read the *first* error,
  distinguish identical from cascading failures, fix only the first if cascading.

No LLM call in the hook — shell state plus templated text, with the reasoning
deferred to the model reading the injected context. For us the commands to watch
are `pnpm test`, `tsc`, `pnpm lint`, and probably `bbx` subcommands.

## Do not copy their state design

Theirs lives in bare `/tmp` keyed only by the command string — not by session or
project. Two unrelated checkouts both running the same test command share a
counter, so a stale count from an earlier session can trip "debugging loop
detected" on the first real failure of a new one. Their own intent-routing hook
gets this right by folding in the session id; the critic hook just didn't.
Session-scope ours, and expire the state.

## Open questions

- Our `.claude/settings.json` currently has one `PostToolUse` lint hook plus
  worktree/session lifecycle hooks. Adding a failure-path hook is new territory —
  check the event exists and behaves as assumed on the Claude Code we run before
  building (their docs pin several behaviours to specific point releases that
  aren't verifiable from their checkout).
- Escalation text must not fight `bbx-debug` when the skill is already loaded. It
  should probably *point at* the skill's Phase 1 rather than restating a recovery
  procedure the skill already owns.
- Noise risk: a genuinely iterative task (fixing 20 type errors one file at a
  time) will fail the same command repeatedly for legitimate reasons. Needs a
  same-error check, not just a same-command count.
