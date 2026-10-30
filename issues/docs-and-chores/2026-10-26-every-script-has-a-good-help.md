---
title: "Every script should answer --help with useful text, and a check should keep new scripts from shipping without it"
workstream: unattached
area: dev-tooling
labels: [bin, cli]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request, 2026-10-26
---

Agents and the boxholder find out how a script works by running it with
`--help`. Many scripts do not support it. Some print an error
(`bin/theme-check --help` prints "Unknown option '--help'"). Two scripts
used to do their real work when given `--help`:
[finish-verify ran the full verification](../closed/bugs/2026-10-10-finish-verify-help-runs-full-verification.md)
and [browse screenshot took a screenshot](../closed/bugs/2026-10-07-browse-screenshot-help-takes-a-screenshot.md).

A rough search on 2026-10-26 found no `--help` handling in 12 of the 23
executables at the top of `bin/`, among them `apple-test`, `browse` (the
top level), `cross-model-run` (its usage text never names `--help`),
`dev-apps-typecheck`, `issues`, `quota-room`, `smoke`, `theme-check`, and
`tour`. The search did not cover scripts run through `package.json`
(`pnpm <name>`), `beebox/src/scripts/`, `bin/lib/*.sh`, `schedules/`, or
the `bbx` CLI's commands. The inventory is part of the work.

## Wanted

1. **Every script answers `--help` (and `-h`)** with: one line on what it
   does, the usage line, each option with its default, the exit codes, and
   any side effect a person should know before running it (it pushes,
   deploys, deletes, spends money, or takes minutes). It exits 0 and does
   nothing else.
2. **The help is good.** It is written for someone who has not read the
   source, and it matches what the script does.
3. **New scripts get it automatically.** A check fails a commit or the
   suite when a script lacks `--help`. One option: a test that runs each
   script with `--help` in an isolated environment and checks exit 0, a
   usage line, and that it made no change. A shared argument helper in
   `bin/lib/` that prints help from the option table would make the check
   easy to pass.

## Questions for the work

- What counts as a script: executables in `bin/`, `package.json` scripts,
  `beebox/src/scripts/`, schedule entry points, `bbx` subcommands (which may
  already have help through their command framework)?
- Is a script that only wraps another (a thin `exec` shim) covered by the
  check on its target?
- How does the check run a script safely with `--help` when the script does
  not support it yet and would do real work? Start from a static check, then
  run only scripts that pass it.

Related: [bin scripts reimplement git, process, and argv helpers](../closed/code-quality/2026-10-23-bin-scripts-reimplement-git-process-and-argv-helpers.md)
moved some scripts onto shared argument parsing.

**2026-10-28 (retrospective 20261028-234100):** Three more sessions:
theme-colors/20261027T031020Z-implemented.md (`bin/theme-check` and
`bin/exhibits add` reject `--help`), box-backups/20261027T005647Z-landed.md
(asking `pnpm smoke` for help on one flag ran a full smoke), and
no-browse-links/20261028T192051Z-implemented.md (`bbx notify` flags took
three tries; the title is positional).
