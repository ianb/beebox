---
description: "How to build, test, and contribute to Bee Box: how development happens here, repo layout, running from source, and how a change lands."
start-here: [development-process.md, agent-coding.md, development-workflow.md, technologies.md, contributing.md, monorepo-claude-md.md, claude-md.md, code-style.md, testing.md, engineering-principles.md, developer-install.md]
---
Bee Box is developed in an unusually agentic way. One maintainer directs
coding agents (Claude Code and Codex); the agents do most of the typing and
the human decides. The instructions the agents work from live in the
repository, as agent instruction files and skills, and are maintained as
part of the work: when an agent gets something wrong, the instruction is
fixed, not just the code. Work is organized into workstreams, each in its
own worktree and session, landed on main through a verified finish flow,
with plans written before non-trivial work, an issue queue of tensions
rather than mandates, and the other model family reviewing anything bigger
than a small fix. The first page below describes all of that.

The repository is a monorepo: the Bee Box engine, a Chrome extension
(beebox-clerk) that talks to a hosted box, an iOS companion app, a doctest
framework extracted for reuse (agent-doctest), a shared lint and TypeScript
preset (personal-vibe-check), and the generator for this site. All of it is
TypeScript, managed as pnpm workspaces from one root install. Running it
from source is a pnpm install and a `bbx init` of your own box; the
developer install page has the sequence and prerequisites.

Tests are doctests: markdown files under test/ whose fenced code blocks run
as executable examples, in three tiers (pure functions, HTTP routes, and
filesystem operations on a temporary box). `pnpm test:changed` runs only
the tests your change implicates; a pre-commit hook runs typecheck, lint,
and documentation link checks. Work happens on branches that merge into
main, and main auto-deploys the maintainer's own instance, so a merged
change does not appear anywhere a contributor can see it.

The two agent instruction files (the monorepo's and the engine's) and the
code style are the most important pages here: they are what the
maintainer's own coding agent reads before making a change, so they carry
more working detail than the rest. Every directory in this corpus has an
index listing its files. If a page does not cover something, say that the
documentation does not say that, rather than guessing. For what Bee Box is
and whether to use it, the front page is linked below; its pages define the
vocabulary these assume.
