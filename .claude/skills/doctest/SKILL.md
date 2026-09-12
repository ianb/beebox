---
name: doctest
description: Write, run, and triage beebox `.doctest.md` tests, including distinguishing flakes from regressions and rerunning before claiming a fix. Use after choosing doctest as the test tier or when a doctest fails.
---

# Doctests: author, run, triage

Directs the workflow. Read the [syntax reference](../../../agent-doctest/docs/syntax.md)
before writing or changing examples; the path-scoped rule points there too.
Whether a doctest is even the right tier —
pure/route/filesystem, vs scenario/knowledge-audit/browser-probe — is
`bbx-guide-testing`'s call, not this skill's; read it first if that's
still open.

## Authoring

Create `test/<name>.doctest.md` (path mirrors the `src/` file under
test, per `beebox/CLAUDE.md`). Write prose, then fenced examples.
Read an existing doctest near the code you're touching. Blocks are full
TypeScript (esbuild); the traps are in assertion semantics (see the
syntax reference's string-comparison rules), not syntax.

## Running

- One file: `pnpm exec tap test/<path>.doctest.md`
- What your diff implicates: `pnpm test:changed`. Pre-commit runs typecheck +
  lint only, not tests — run this yourself before declaring done. The whole
  suite (`pnpm test`) runs hourly on `main`; not for iteration.
- Force serial (rule out contention as a cause): add `-j1`

**Never declare a doctest fixed without actually running it.** Reading
the diff, typechecking, or a parse-only check tells you the file is
well-formed — not that the assertion passes. Reproduce the original
failure first, then rerun after the fix, in isolation at minimum.

## Flake triage

The suite runs `jobs: 6` in parallel (`beebox/.taprc`) and that
contention is a real, tracked hazard — not every red run is your bug.
Shapes seen repeatedly in `issues/bugs/` (grep there for the current
list before assuming a new one):

- **Settle-wait races** — a timing assertion (fs watcher, poll loop)
  fires before state has actually settled. Fix: poll-until-true, not a
  bigger fixed sleep.
- **Timeout under load** — passes solo, times out only in the full
  run (hub-e2e, login-redirect, run-target). Confirm with an isolated
  rerun before treating it as a regression.
- **"no tests found" with a non-zero exit** — the file crashed during
  module load under contention, not during a test body; looks like an
  empty file, isn't one.
- **A real bug wearing a flake costume** — reproduces every run,
  including on the unmodified tree. Don't assume "the test is wrong"
  just because it's been red a while (see the bulk-upload sweep issue).

Full protocol (isolated rerun, grep `issues/` for a matching
signature, at most one full-suite rerun, when to file a new issue vs
fix inline) is in `.claude/agents/finish.md` — follow it rather than
re-deriving it. File in `issues/bugs/` (see the `issues` skill) when
you hit a new flake shape that isn't tracked yet and isn't yours to
fix right now; fix inline when it's a real bug in code or fixture you
can pin down.
