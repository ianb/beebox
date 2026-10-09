---
title: "`bin/browse screenshot --help` takes a screenshot and writes `--help.json`"
workstream: unattached
area: bin
labels: [tooling]
filed-by: agent
resolution: implemented
discovered-by: agent
discovered-in: skills-review — verifying the browse skill's subcommands against `--help`
---

`bin/browse screenshot --help` does not print help. It treats `--help` as the
output name, takes a screenshot, and writes a file called `--help.json` into
the current directory (observed 2026-10-07 in a worktree; the stray file was
deleted by hand). Other `bin/browse` subcommands print help as expected.

Fix: parse `--help` before positional arguments in the `screenshot`
subcommand (and check the other subcommands that take a positional output
name), and refuse output names that start with `-`.

**Done (2026-10-08):** `browse screenshot` parses `--help`/`-h` as help, refuses unknown options and a second path, and never treats a dash-leading token as the output name (`browse/src/cli.ts`, doctest `browse/test/cli.screenshot-args.doctest.md`). Landed in 92f002ef0.
