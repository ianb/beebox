---
title: "Shellcheck the shell embedded in box cards (procedure gates, scheduled-script `runs:`)"
workstream: unattached
area: beebox
labels: [validation, procedures, scheduler]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-document-card-view — a merge tripped the new schedules/ shellcheck gate; the boxholder assumed procedures already got one
---

Shell that lives inside box cards is executed but never linted. The
monorepo's own `schedules/<name>/run` scripts now get shellcheck at pre-commit
(`bin/lib/schedules-lint.ts`, run by `bin/schedules`), and the boxholder
assumed box procedures had the same check. They do not: nothing in
`beebox/src` references shellcheck, and `bbx validate` checks card shape
only.

Where shell lives in cards today:

- procedure cards — step `validate.shells` gate commands (the only enforced
  gate for agent-applied migrations, per `docs/migrations.md`), and any `runs:`
  in steps;
- `*.scheduled-script.card` — the `runs:` command `bbx tick` executes
  (`src/cli/commands/tick.ts`, `tick-helpers.ts`);
- agent-authored scripts under the package's `src/tricks/`.

A bad quoting or `$var` bug in a gate command fails open or closed at run time
with no earlier signal, and these are written by agents.

Proposed: a `bbx validate` pass that extracts the shell strings from those
fields, writes each to a temp file, and runs `shellcheck` on it (report at the
card's file:line). Follow the `bin/lib/schedules-lint.ts` shape. Decide: is a
missing `shellcheck` binary a warning (skip) or a hard error? — the pre-commit
hook `bbx init` installs runs `bbx validate --pre-commit` on every box commit,
so a hard error would block box commits on any machine without shellcheck.

Provisioning: add `shellcheck` to `deploy/setup-server.sh:22` and the
developer install lists (`docs/developer-install.md:32,36`) — today only the
dev-machine `schedules/` gate needs it, and it is not in either list.
