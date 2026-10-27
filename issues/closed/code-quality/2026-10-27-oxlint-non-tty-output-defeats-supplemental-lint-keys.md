---
title: "oxlint prints one-line findings when not on a terminal, so the supplemental-lint baseline keys them by position again"
workstream: unattached
area: dev-tooling
labels: [code-quality, schedules, lint]
filed-by: agent
discovered-in: dep-reduction — 2026-10-27
resolution: implemented
---

Closed 2026-10-27 on the dep-reduction workstream. beebox `lint:oxlint` passes `-f default`, and `schedules/supplemental-lint/lib.ts` says the parse needs that format. A non-TTY run now prints the graphical format, and `reportLines` turns it into position-free lines.

`schedules/supplemental-lint/lib.ts` turns each oxlint finding into one line
made of the rule header and the flagged source line, so a finding keeps its
identity when its file moves (run 20261003-193157). That parse expects
oxlint's graphical output (`! rule: …`, `,-[file:line:col]`, source excerpt).

oxlint 1.66 prints a compact format when stdout is not a terminal:

```
src/core/box-backup/local-runner.ts:90:26: warning unicorn(no-useless-spread): … help: …
```

`run.ts` runs `pnpm --dir beebox lint:oxlint` through execa, so that run gets
the compact lines. They pass through `reportLines` unchanged, with the path,
line and column in them. A move or an edit above a finding reports it as new
again.

`-f default` forces the graphical format. `lint:circular` passes it as of the
dep-reduction workstream. Adding it to `lint:oxlint` in `beebox/package.json`
fixes the sweep. The first run after the change reports every existing
finding as new once, because the stored baseline holds compact lines.
