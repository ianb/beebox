---
description: "How to build, test, and contribute to Bee Box: repo layout, running from source, and how a change lands."
start-here: [contributing.md, claude-md.md, code-style.md, testing.md, engineering-principles.md, developer-install.md]
---
This repository is a monorepo: the Bee Box engine itself, a Chrome extension
(`beebox-clerk`) that talks to a hosted box, an iOS companion app, a doctest
testing framework extracted for reuse (`agent-doctest`), a shared ESLint/TypeScript/Prettier
preset (`personal-vibe-check`), and the generator for this public site. All
of it is TypeScript, managed as pnpm workspaces from one root install.

Running it from source is a `pnpm install` followed by a `bbx init` of your
own box; the full sequence, prerequisites, and platform notes are in
[developer-install.md](developer-install.md).

Tests are doctests: markdown files under `test/` whose fenced code blocks run
as executable examples, in three tiers (pure functions, HTTP routes, and
filesystem operations on a temporary box). `pnpm test:changed` runs only the
tests your change implicates.

A pre-commit hook runs typecheck, lint, and documentation link checks before
a commit is allowed. Work happens on branches that merge into `main`, and
`main` also auto-deploys the maintainer's own running instance, so
contributors should not expect their merged change to appear anywhere they
can see it.

Outside scheduled work, `issues/` at the repository root holds one markdown
file per idea or problem, filed as a tension to consider rather than a
mandate to act on.

`CLAUDE.md` and `code-style.md` are the two most important pages here: they
are the instructions the maintainer's own coding agent reads before making a
change, so they carry more working detail than most of what follows. Every
directory in this corpus has an `index.md` listing its files. When you use
these pages to answer a question, cite the page the answer came from, and if
a page does not cover something, say that the documentation does not say
that, rather than guessing.

For what Bee Box is and whether to use it, the evaluator entry point is
`llms.txt`, linked below; the spine pages there define the vocabulary these
pages assume.
