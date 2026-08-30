---
title: "Do our subagents inherit the monorepo CLAUDE.md and its rules?"
workstream: elixir-skills-review
area: docs
filed-by: agent
discovered-in: worktree-elixir-skills-review — reviewing claude-elixir-phoenix
---

The reviewed project injects a condensed restatement of all 26 of its
non-negotiable rules into **every** spawned subagent via a `SubagentStart` hook.
The comment names the motivation: "addresses #1 session-analysis finding: zero
skill auto-loading in subagents." Their position is that subagents don't inherit
the parent's loaded skills, so a hook is the only channel by which the rules
reach delegated work at all. See
[research/claude-elixir-phoenix](../../research/claude-elixir-phoenix/enforcement-and-hooks.md).

We delegate constantly — CLAUDE.md explicitly encourages it, and Fable-driven
sessions are told to push substantial work to subagents. If a general-purpose
subagent doesn't see our CLAUDE.md, then a long list of things we consider
settled are silently absent from most of the work we delegate: never disable a
lint rule, TypeScript only, no real home-dir paths in tracked files, don't
restart the shared dev router, commit-with-hooks, the worktree stash hazard.

## Verify before building anything

This is a factual question about the Claude Code we run, and their claim is
about *plugin skills* not auto-loading — which may not generalise to a project
CLAUDE.md, since those are believed to propagate to subagents by default. Do not
build an injection hook on the strength of their finding.

Concrete check: spawn a general-purpose subagent with no context beyond a
question, and ask it to state a rule that appears only in the monorepo CLAUDE.md
(the shared-dev-router prohibition is a good probe — specific, unguessable, and
not inferable from the code). Repeat for a typed agent (`.claude/agents/finish.md`
sets its own tool list) and for a subagent spawned *by* a subagent, if that's
reachable.

## Then

- If they do inherit it: close this, and note it in the review so we don't
  re-derive the question.
- If they don't: the fix isn't necessarily a hook. Options include a short
  standing preamble in the prompts we write when spawning, or a small named set
  of rules that genuinely must survive delegation — which is a different and
  smaller thing than our whole CLAUDE.md, and worth choosing deliberately rather
  than injecting everything.

Related: `beebox/src/core/agent-guide/laws.ts` already does the
"small set of named, inviolable rules that outrank everything else" pattern for
*box* agents. There's no dev-repo equivalent, and if this turns out to be a real
gap, that file is the model for what a good answer looks like.
