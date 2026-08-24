---
title: "Run the periodic code-health sweeps weekly, and build the thing that runs them"
workstream: unknown
---

2026-08-24 · from the knip-exports workstream (boxholder decision).

knip's `exports` check is on and the backlog is cleared, so from here the
question is when it runs. **Not per-commit.** A dead export is not a broken
build; blocking a commit on one is the wrong severity, and pre-commit is
already slow. The right cadence is **weekly**, as a report someone reads.

That applies to the other entries in `callback-box/docs/maintenance.md` with
no schedule behind them: `lint:knip`, `lint:oxlint`, `lint:circular`. Their
cadence column says things like "Before releases; when code feels
accumulated" — which means "never" in practice, and is why the export backlog
reached 651.

## The missing piece

There is no general way to schedule a dev-repo task. What exists is one
bespoke precedent: `bin/manual-tests-scheduled.sh --install` registers a
launchd job, runs weekly, and files a local issue plus a notification on
failure. `bin/update-agent-sdk-scheduled.sh` is a second, built the same way.
A third hand-rolled launchd script is the wrong answer.

What a general mechanism needs, taking those two as the requirements:

- one place to declare "run X on cadence Y", instead of a script per task
- output that lands somewhere durable and readable, not just a console the
  cron job throws away
- a failure path that reaches the boxholder — the manual-test job's
  file-an-issue-and-notify shape is the model
- something that works when the machine was asleep at the scheduled time
  (launchd's `StartCalendarInterval` fires on wake; a naive timer does not)
- a way to run it on demand, so it is testable without waiting a week

## Blocker for knip specifically

A weekly knip report is only useful if it is quiet when nothing is wrong.
Right now `pnpm lint:knip` exits non-zero on pre-existing noise that has
nothing to do with dead code:

- **19 unlisted binaries.** Two kinds. System tools that legitimately are not
  npm deps (`pdfinfo`, `pdftotext`, `pdftoppm`, `qpdf`, `uvx`, `tar`, `cb`) —
  these want `ignoreBinaries` entries. And `tsc`, `tsx`, `eslint`, `tap`,
  `oxlint`, `knip`, `madge`, which ARE declared devDependencies and are
  *also* reported as unused devDependencies at the same time. knip is failing
  to link the package.json scripts to the deps they invoke; the contradiction
  is the tell. Root cause not diagnosed.
- **14 unused dependencies/devDependencies.** `husky` and `lint-staged` are
  real but used by the monorepo-root `.husky/`, not by callback-box.
  `@googleworkspace/cli`, `react-compiler-runtime`, and
  `babel-plugin-react-compiler` are runtime/build-tool deps knip cannot see.

All of it predates this workstream — verified by running main's `knip.json`,
which reports the same classes (14 binaries / 8 deps; the count grew only
because the frontend's own config was folded in and had never been run).

Until that is quiet, a weekly report is 33 lines of noise around whatever it
actually found.
