# How development happens here

This describes the process rather than the code, for a contributor reading from
a clone and for the coding agent beside them. Bee Box is early: one maintainer,
changing fast. Bug reports are invited; pull requests are not yet solicited
([CONTRIBUTING.md](../../CONTRIBUTING.md)).

The codebase is written by coding agents, under one maintainer's direction, in
two families: Claude Code and Codex. The agents do the typing. The human decides
what gets built, reviews the plans and the prose, and lands the work. The
instructions the agents read are checked into the repository and maintained as
part of the work.

**[Agent coding, and the checks around it](agent-coding.md)** covers where those
instructions live, how the two model families review each other's work, and the
strictness the code is held to: strict types, lint rules that are never weakened
to make code pass, noisy output treated as a bug, the pre-commit hooks, and the
rule that nothing learned on a real box reaches this repository unscrubbed.

**[Testing](testing.md)** has the tiers, the doctest syntax, and the helpers.
**[Testing what agents know and do](agent-testing.md)** covers what surrounds
them: typed fakes for every external service, change-selected test runs, the
hourly full suite, the smoke walk that boots a real box before a merge, weekly
browser tours, and the two things that test agents rather than code, knowledge
audits and the user-stories catalog.

**[The development workflow](development-workflow.md)** covers how a piece of
work moves: its own worktree, branch, and session, started from a briefing and
landed on `main` by the `finish` skill; the issue queue and its categories and
next-action tags; recurring work under `schedules/`; document comments; the
planning taxonomy under `docs/plans/` and how a plan is reconciled when the work
lands; and exhibits, the page an agent builds to show work with exactly one ask
on it.

**[Technologies and AI services](technologies.md)** names the stack and the
external model services a box can be configured to use.
