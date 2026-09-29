---
title: "Usability review of doctest: look back at its design now that agents write and run it constantly"
workstream: doctest-usability
needs: [design]
area: beebox
labels: [testing, doctest, agents]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
---

Doctest (`agent-doctest/`) is the default test form in this repository.
About 1,000 `.doctest.md` files hold about 143,000 non-blank lines, and
agents write and run them in almost every session. The developer wants a
usability test of doctest and a look back at its design, based on how it is
actually used.

## Evidence to start from

Problems agents hit while writing doctests. Collect more from session
transcripts, commit history, and memory notes.

- **Prose inside a fence.** Explanatory text must go after the closing
  fence, followed by a new fence with `ts continue`. Agents put prose
  inside the fence and get parse failures. One session made this mistake
  three times.
- **A second example read as expected output.** In a fence, a line after
  `=> expected` that starts a new expression was read as part of the
  expected output. The test failed with a diff that showed the second
  expression inside "expected". Seen 2026-09-27 in
  `beebox/test/core/codex-transcript.doctest.md`. The fix was a separate
  fence.
- **Name collision with the runner.** A setup variable named `t` collided
  with the runner's own `t`, and the test failed with
  "t2.request is not a function". Seen 2026-09-27 in
  `beebox/test/webapp/trpc-batch-url-length.doctest.md`.
- **Flakes against regressions.** The doctest skill spends much of its
  length on telling a flake from a regression, and on rerunning before
  claiming a fix. That is a sign that failures are hard to read.

## What the review should cover

- **Writing.** Which syntax rules agents break most often, and whether the
  syntax or its error messages should change instead of the instructions.
- **Reading failures.** Whether a failure message leads to the cause: the
  diff, the source location, and which fence and example failed.
- **Running.** Speed, test selection (`pnpm test:changed`), and output
  volume.
- **Fit.** Which kinds of test doctest serves badly. This decides which
  `*.test.ts` files should stay code in the
  [conversion to doctests](../code-quality/2026-09-27-convert-test-ts-files-to-doctests.md).

A usability test here means giving agents defined test-writing tasks and
recording where they go wrong, not only reading the code.
