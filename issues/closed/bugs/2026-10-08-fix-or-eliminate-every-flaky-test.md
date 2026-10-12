---
title: "Fix or eliminate every flaky test: the 49 doctests that have failed on their own"
workstream: flaky-tests
resolution: implemented
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

## Progress (2026-10-12, worktree-flaky-tests)

Count only lone failures. A file that failed while the runs on either side
passed it is a flake candidate. A file that failed in a streak was a red,
fixed later. By that count, `release.manifest` (the most frequent at 52) was
never a flake: it went red four times, each time `package.json` `files`
changed and the test's snapshot of that list did not.

Fixed, with mechanism and commit:

- `release.manifest`: files-list snapshot removed; globs expanded (6b9cbda61).
- `hub/supervisor`: the test asserted a closure that box-maintenance-no-wedge
  removed. It passed only inside the release race (f561654da).
- `hub/supervisor.maintenance`: a cold real-server boot under load exceeded
  the hub's 30 s `READY_TIMEOUT_MS` (2a3ecb9a2).
- `lib/git-stale-lock`: the machine-wide `lsof` timed out under load
  (1cf9bd509).
- `core/migrations.timeout`: the 2 s budget also covered setup; the test now
  cancels at the point under test (0edc6a71f).
- `cli/lib/session-retention`: the fixture no longer discriminated at the
  128 MB cap (3fc167201).
- `core/box/file-watcher`: injected watcher (de19a242f, 43e5cb224).
- `hub.e2e`: its shutdown wait was shorter than the hub's own kill window,
  and a frontend build ran inside the test (3d45be34e).
- `webapp/routes/bulk-upload`: worker outlived cleanup; non-persistent
  schema watcher (925b527e4, 671f862a5, 0d9022a4a).
- `chat/send-run.wedge-guards`, `chat.reserved-features`,
  `chat.reload-loses-in-flight`, `send-dedup.durable-claim`: an unawaited
  run's bootstrap commit outlived cleanup (3705fad53, 8d622bf43, 3ffc0f548).
- `hub/server.router`: Retry-After counted down on the real clock
  (c35a552df).
- `deploy/nginx-site`: ECONNRESET during reload (58734e0b7).
- `core/scan/promote-debounce`: mocked timers (0a31d42bd).
- `core/last-audio-pending`: 100 ms poll (4864824f7).

Already fixed before this work, verified: `session.oversize-lines`
(50961ada5), `pdf/extract.integration` (a63151636), `chat.hq-preferences`
(file deleted 10-09; product race fixed f1ba1944e).

careful.txt: `file-watcher`, `hub.e2e`, `git-lock` and `bulk-upload` left
(683994491).

## Resolution (2026-10-12)

The developer decided three points on 2026-10-12:

- The two field-test files stay in careful.txt. They run the real `bbx init`
  and `bbx serve`, and making them deterministic would mock away what they
  test. The careful.txt header now says that only such files belong there
  (2dd633488). This replaces "careful.txt empty" in the done criterion above.
- `git-lock` stays out of careful.txt with no code change. No mechanism was
  found; its one recent failure happened during a machine-wide stall.
- The remaining one-off entries close as "no recurrence", with the counts
  below.

Follow-on work from this issue:

- Chat shutdown now waits for a send that is still opening its turn
  (4454aba2c). That was the product cause of four chat flakes. A server close
  during a first send let the start continue against a box being torn down.
- The hub's fixed 30-second readiness limit, the cause of the
  `supervisor.maintenance` failures and part of the field-test and hub.e2e
  failures, is filed as
  [a bug](../../bugs/2026-10-12-hub-readiness-limit-kills-slow-healthy-box-children.md).

Earlier names of files fixed above:

- `test/core/migration-timeout.doctest.md` is now `migrations.timeout`.
- `test/webapp/chat-send-durable-claim.doctest.md` is now
  `send-dedup.durable-claim`.
- `test/hub/server-maintenance.doctest.md` is now `supervisor.maintenance`.
- `test/core/last-audio.doctest.md` is now `last-audio-pending`.
- `test/webapp/trpc-hq-preferences.doctest.md` became `chat.hq-preferences`,
  then `chat.reserved-features`.

Deleted since their last failure: `frontend/lib/ui-scan/annotations`,
`core/migrations/one-root-migration` and `core/migrations/one-root-move-plan`.

No recurrence. Each count is the number of passing hourly runs since the
file's last failure, through renames; the current name follows where it
changed:

- `test/dev/launch-session.doctest.md`: 193
- `test/core/loader-registry.doctest.md`: 214
- `test/core/landmark/landmark-schema.doctest.md`: 214 (`resolve.schema`)
- `test/cli/commands/validate-box-checks.doctest.md`: 214 (`box-checks`)
- `test/webapp/trpc-presentation.doctest.md`: 214 (`presentation`)
- `test/dev/auto-sweep-detach.doctest.md`: 73
- `test/webapp/login-redirect.doctest.md`: 225 (`base-prefix.login-redirect`)
- `test/webapp/mobile-spa-fallback.doctest.md`: 225 (`server-root.spa-fallback`)
- `test/dev/workstream-list.doctest.md`: 90 (`workstreams.list`)
- `test/lib/exec-with-timeout.doctest.md`: 290
- `test/hub/child-output-log.doctest.md`: 315
- `test/lib/git.doctest.md`: 84
- `test/core/box-inventory.doctest.md`: 84
- `test/webapp/routes/scan-upload.doctest.md`: 266
- `test/core/migration-gitignore.doctest.md`: 151 (`gitignore`)
- `test/webapp/views-compiler-v2.doctest.md`: 154 (`compiler.v2`)
- `test/cli/lib/init.doctest.md`: 176 (`structure.init`)
- `test/webapp/routes/chat-schedule-fire.doctest.md`: 152 (`schedule-fire`)
- `test/cli/commands/view-test-command.doctest.md`: 68 (`command.test-command`)
- `test/scenarios/cross-box-probe.doctest.md`: 84
- `test/webapp/chat-send-run-start-failure.doctest.md`: 122 (`send-run.start-failure`)
- `test/webapp/trpc/routers.namespace-fence-traversal.doctest.md`: 95
- `test/core/procedure/engine.doctest.md`: 84

Count a file as a flake only when it fails and the runs on either side
pass it. A file that fails in several runs in a row is a test that stayed red.
