---
title: "Look into the \"impeccable\" skill — what it is and whether we want it"
workstream: unattached
area: monorepo
needs: [design]
labels: [research, skills]
filed-by: agent
discovered-by: Ian
discovered-in: main session — bbx feedback triage
priority: important
---

A popular skill called **"impeccable"** came up as worth looking into. That's
the whole of what's known — this is a "check out X" item.

## What to find out

- What it does, and what problem its users say it solves.
- Whether it's a *skill* in the Claude Code sense (a `SKILL.md` invoked by
  name) or something looser that gets called one.
- What makes it popular — the mechanism, not the marketing. Popular skills tend
  to encode a *discipline* rather than a capability, and the discipline is the
  portable part.
- Whether any of it belongs here, and in what form: adopt as-is, borrow the
  idea into an existing skill, or decline.

## How to judge it

This repo already has a dense skill set — `bbx-plan`, `bbx-debug`, `cross-model`,
`finish`, `browse`, `doctest`, `knowledge-audit`, `issues` and more — several of
which encode hard-won discipline (the tracked-flake protocol, the docs-only fast
path, cross-model review). So the bar isn't "is this good," it's **"does it do
something none of ours does, or do it better."**

Two failure modes worth avoiding explicitly. Adopting a skill whose discipline
duplicates one already in the set adds surface without adding judgment — and the
skill roster is itself context every session pays for. And a skill that's
popular because it suits a different working style (shorter tasks, no
worktrees, no box) can read well and fit badly.

Record the finding under `research/` alongside the other external evaluations
(see `research/external-skills-harvest.md`, which already does this kind of
triage) and link back here with a recommendation — including "no", if that's the
answer.
