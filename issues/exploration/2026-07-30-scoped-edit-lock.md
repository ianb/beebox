---
title: "Scoped edit-locks — a sentinel file plus a PreToolUse gate"
workstream: elixir-skills-review
area: beebox
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
priority: backlog
next-action: discuss
---

A small mechanism from
[research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/enforcement-and-hooks.md)
that we have no equivalent of. A `PreToolUse` hook on Edit/Write/NotebookEdit
reads a sentinel file:

- absent → dormant, no-op (safe to ship enabled);
- present and empty → **all** edits denied (investigation mode);
- present with path lines → only edits at or under a listed prefix allowed.

Denials return `permissionDecision: "deny"` plus context telling the agent not to
retry and to ask instead — which matters, because the default agent response to a
blocked edit is to try a different route to the same change.

## What it's for

`bbx-debug` has whole phases that should be read-only (Phase 1 builds a feedback
loop, Phase 2 reproduces), and `bbx-plan` is entirely a writing-about-code
activity. Both describe that discipline in prose only. Scope creep during
investigation — "while I'm here" edits that muddy what actually fixed the bug —
is a real and common failure, and this catches it at the moment it happens rather
than in review.

## Be honest about what it isn't

It's **self-bypassable by design**. The skill that toggles the sentinel does so
via Bash rather than Edit/Write, specifically so the gate can't block the skill
from lifting its own lock — and that same escape hatch means an agent can just
delete the file. Their dependency gate has the same property via an env-var
override with no distinction between "the human authorised this" and "the agent
routed around a block it disliked."

So: a guardrail against drift, not a boundary against misbehaviour. Worth having
on those terms; not worth describing as enforcement.

## Open questions

- Is prose actually failing us here? Neither `bbx-debug` nor `bbx-plan` has a known
  history of scope-creep incidents — this might be solving a problem we don't
  have. Worth a look at recent worktree diffs before building.
- Interaction with our worktree model: a lock is per-checkout state, and several
  sessions run at once. Sentinel must be worktree-local and gitignored.
- Who sets it — the human, or a skill entering a read-only phase? Self-imposed
  locks are the more interesting version and the more suspicious one, since the
  agent that set it can lift it.
