---
title: "Fix or eliminate every flaky test: the 49 doctests that have failed on their own"
workstream: unattached
area: beebox
labels: [tests, flake]
filed-by: agent
discovered-by: Ian
discovered-in: skills-review — full-suite failure data, 2026-10-08
---

855 hourly full-suite runs (2026-08-25 to 2026-10-08): 240 failed, 135 of
them on exactly one file. 49 doctest files have failed in a run where at
most five files failed (an isolated failure, so not a red-main episode).
Those are the flakes, or the tests that caught something real; go through
every one and decide which, then fix the flake, eliminate the test, or mock
the thing that flakes (timers, the filesystem watcher, network, a real
process). A named flake is not an issue to file; `beebox/test/careful.txt`
is the holding channel, and today it names 6 files, 5 of which appear
below. The goal is that list going to zero.

The list, with isolated-run count, mass-episode count, and last failure
(regenerate from `~/src/schedule-runs/full-suite/runs/*.log`; the script is
in the session that filed this and is four lines of grep over `not ok`):

- `test/core/box/file-watcher.doctest.md`: 89 isolated, 8 in mass episodes, last 2026-10-06
- `test/frontend/lib/ui-scan/annotations.doctest.md`: 33 isolated, 2 in mass episodes, last 2026-09-22
- `test/scripts/release-manifest.doctest.md`: 28 isolated, 0 in mass episodes, last 2026-09-27
- `test/hub/hub-e2e.doctest.md`: 17 isolated, 8 in mass episodes, last 2026-09-18
- `test/dev/launch-session.doctest.md`: 12 isolated, 0 in mass episodes, last 2026-09-04
- `test/core/loader-registry.doctest.md`: 12 isolated, 2 in mass episodes, last 2026-09-12
- `test/core/landmark/landmark-schema.doctest.md`: 12 isolated, 2 in mass episodes, last 2026-09-12
- `test/cli/commands/validate-box-checks.doctest.md`: 12 isolated, 2 in mass episodes, last 2026-09-12
- `test/hub/supervisor.doctest.md`: 11 isolated, 3 in mass episodes, last 2026-10-08
- `test/core/pdf/extract.integration.doctest.md`: 9 isolated, 2 in mass episodes, last 2026-10-04
- `test/lib/git-stale-lock.doctest.md`: 7 isolated, 6 in mass episodes, last 2026-10-08
- `test/webapp/trpc-presentation.doctest.md`: 6 isolated, 1 in mass episodes, last 2026-09-12
- `test/cli/lib/session-retention.doctest.md`: 6 isolated, 1 in mass episodes, last 2026-10-07
- `test/webapp/trpc/routers/chat.hq-preferences.doctest.md`: 6 isolated, 0 in mass episodes, last 2026-10-07
- `test/field-test/run.doctest.md`: 5 isolated, 3 in mass episodes, last 2026-09-11
- `test/core/migrations/one-root-migration.doctest.md`: 5 isolated, 6 in mass episodes, last 2026-09-16
- `test/webapp/trpc-hq-preferences.doctest.md`: 5 isolated, 0 in mass episodes, last 2026-09-27
- `test/core/migrations.timeout.doctest.md`: 5 isolated, 0 in mass episodes, last 2026-10-06
- `test/cli/lib/session.oversize-lines.doctest.md`: 5 isolated, 1 in mass episodes, last 2026-10-05
- `test/dev/auto-sweep-detach.doctest.md`: 4 isolated, 5 in mass episodes, last 2026-09-16
- `test/core/migrations/one-root-move-plan.doctest.md`: 4 isolated, 2 in mass episodes, last 2026-09-05
- `test/core/migration-timeout.doctest.md`: 4 isolated, 0 in mass episodes, last 2026-09-26
- `test/webapp/login-redirect.doctest.md`: 3 isolated, 2 in mass episodes, last 2026-09-11
- `test/webapp/mobile-spa-fallback.doctest.md`: 3 isolated, 2 in mass episodes, last 2026-09-11
- `test/dev/workstream-list.doctest.md`: 3 isolated, 0 in mass episodes, last 2026-09-14
- `test/webapp/routes/bulk-upload-routes.doctest.md`: 2 isolated, 1 in mass episodes, last 2026-09-05
- `test/lib/exec-with-timeout.doctest.md`: 2 isolated, 0 in mass episodes, last 2026-09-04
- `test/hub/child-output-log.doctest.md`: 2 isolated, 0 in mass episodes, last 2026-08-31
- `test/field-test/lifecycle.doctest.md`: 2 isolated, 1 in mass episodes, last 2026-09-03
- `test/lib/git.doctest.md`: 2 isolated, 1 in mass episodes, last 2026-10-01
- `test/webapp/chat-send-durable-claim.doctest.md`: 2 isolated, 0 in mass episodes, last 2026-09-21
- `test/core/box-inventory.doctest.md`: 2 isolated, 2 in mass episodes, last 2026-10-01
- `test/hub/server-maintenance.doctest.md`: 2 isolated, 1 in mass episodes, last 2026-09-24
- `test/hub/supervisor.maintenance.doctest.md`: 2 isolated, 0 in mass episodes, last 2026-10-08
- `test/lib/git-lock.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-09-24
- `test/core/last-audio.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-09-21
- `test/webapp/routes/scan-upload.doctest.md`: 1 isolated, 0 in mass episodes, last 2026-09-06
- `test/core/migration-gitignore.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-09-15
- `test/webapp/views-compiler-v2.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-09-16
- `test/cli/lib/init.doctest.md`: 1 isolated, 0 in mass episodes, last 2026-09-16
- `test/webapp/routes/chat-schedule-fire.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-09-19
- `test/cli/commands/view-test-command.doctest.md`: 1 isolated, 3 in mass episodes, last 2026-09-20
- `test/scenarios/cross-box-probe.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-10-01
- `test/webapp/chat-send-run-start-failure.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-09-24
- `test/webapp/trpc/routers.namespace-fence-traversal.doctest.md`: 1 isolated, 0 in mass episodes, last 2026-09-28
- `test/core/procedure/engine.doctest.md`: 1 isolated, 1 in mass episodes, last 2026-10-01
- `test/webapp/routes/chat/send-run.wedge-guards.doctest.md`: 1 isolated, 0 in mass episodes, last 2026-10-07
- `test/core/last-audio-pending.doctest.md`: 1 isolated, 0 in mass episodes, last 2026-10-07
- `test/hub/server.router.doctest.md`: 1 isolated, 0 in mass episodes, last 2026-10-08

Working order: the top four account for most isolated failures
(`file-watcher` is 89 of them; it is a timing test on a real watcher and
is the first candidate for a fake clock or a mocked watcher). After the
top ten, the rest are one to five failures each and may be real
regressions caught once; check the run's log before calling one a flake.
Done means: every entry either fixed with the cause named, or removed with
the reason, and `careful.txt` empty.
