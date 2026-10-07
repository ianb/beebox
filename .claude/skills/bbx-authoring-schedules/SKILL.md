---
name: bbx-authoring-schedules
description: Create, migrate, or troubleshoot recurring monorepo work under `schedules/`. Use when time or cadence should trigger a task, to schedule a task, or to replace a launchd job.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Authoring a schedule

A schedule is one tracked directory, `schedules/<name>/`. One launchd tick
drives all of them, and due-ness comes from stored state, so a machine that
slept catches up once. Read [bin/docs/schedules.md](../../../bin/docs/schedules.md)
before writing or changing one; `bin/schedules help` lists the commands and
`bin/schedules list` is the catalog.

Rules to apply before reading further:

- A schedule exists only when time triggers the work. A commit trigger is a
  hook; a request is a session.
- `run` owns mechanics: gather, compare, decide whether anything changed, and
  exit 0 silently when nothing did. `prompt.md` owns judgment and states the
  session's authority, priority mapping, and reporting.
- Rehearse with `bin/schedules run <name> --dry-run`, then one `--force` run,
  and `bin/schedules lint` before committing.
