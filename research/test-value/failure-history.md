# What a test failure meant in this repo

Evidence for the test-value research note. Sources: the test ledger
(`.git/beebox-test-ledger.jsonl`, 2026-08-30 to 2026-10-23), the closed and
open `full-suite-red` issues, the flake issues, and
`schedules/full-suite/{red,triage,alerts,lib}.ts`. Scripts are in `scripts/` (they read the ledger paths from the `LEDGER` and
`FILESETS` environment variables); the per-file tables are in `data/`:

- `scripts/ledger_analysis.py` -> `data/full_per_file.csv`, `data/selected_per_file.csv`
- `scripts/episodes2.py` -> `data/full_episodes.csv`

## 1. Method and counts (ledger)

Records: 2771 raw; 410 are completion markers (no files ran); 1 run is
incomplete (exit 143); 2360 measured runs. 959 `full`, 1401 `selected`.
Of the full runs, 827 were written by the hourly `schedules/full-suite` job
(414 ordinary-tier + 413 careful-tier records; one hour = two records) and 132
were humans/agents running `pnpm test` in a checkout. Months: Aug 21, Sep 545,
Oct 393.

File names: `*.doctest.md` merged into `*.test.ts` (same base name). Files
that MOVED during the 2026-09-27 layout moves (for example
`test/webapp/trpc-hq-preferences` -> `test/webapp/trpc/routers/chat.hq-preferences`,
`test/core/migration-timeout` -> `test/core/migrations.timeout`) are NOT
merged; they appear twice in the tables. 2003 distinct file names appear in
the fileset manifest; the live suite is about 1950.

Definitions used here:

- **Isolated run**: a full run with 1-3 failing files. **Moderate**: 4-20.
  **Mass red**: more than 20, which is the schedule's own environment bar
  (`ENVIRONMENT_FAILURE_FILES = 20` in `schedules/full-suite/lib.ts`; such a
  run is alerted as environment and nothing is bisected or filed).
- **Flake (ledger rule)**: `deriveFlakes` in `bin/test-ledger-lib.ts`: a file
  fails and then passes on a later run at the identical commit AND tree hash.
  Only the schedule and a developer re-running without edits can produce this.
- **Episode**: consecutive observations of one file failing, over the
  chronologically sorted full runs that RAN that file, broken by a run that
  ran it and passed. This matters because the hourly schedule re-runs a
  known-red file every hour; "times failed" counts hours, "episodes" counts
  events.

### Full runs

| measure | value |
|---|---|
| full runs (measured) | 959 |
| green / red | 575 / 384 |
| red runs by failing-file count: 1 / 2 / 3 / 4-20 / >20 | 283 / 40 / 11 / 36 / 10 |
| buckets: isolated / moderate / mass | 334 / 36 / 10 |
| distinct files ever run in a full run | 1947 |
| files that ever failed in a full run | 621 (32%) |
| files that never failed | 1326 (68%) |
| files that failed ONLY inside mass-red runs | 389 (63% of the 621) |
| files with at least one isolated-run failure | 75 (3.9% of 1947) |
| failure episodes (all 621 files) | 926 |
| episodes that lasted one run | 879 (95%) |
| episodes of 4+ consecutive runs | 25, in 20 files |
| flake events by the ledger rule, full runs only | 55 events in 55 files |
| flake events, all modes | 450 events in 401 files |

Distribution of per-file full-run failure counts (files x times failed):
1: 442, 2: 113, 3: 25, 4: 8, 5: 7, 6: 2, 7: 3, 8: 5, 9: 2, 10: 2, 12: 1,
14: 1, 15: 4, 16: 1, 24: 2, 25: 1, 27: 1, 101: 1.

Distribution of per-file episode counts: 1: 452, 2: 117, 3: 25, 4: 10,
5: 7, 6: 3, 7: 2, 8: 3, 14: 1, 20: 1.

The ten mass-red runs (>20 files), for the record: 2026-09-09 (25),
09-11 (30), 09-12 (21), 09-16 (66), 09-17 (24), 09-18 (25), 10-01 (23),
10-05 (58, 25 of them `test/cli/commands`), 10-18 (250, on the
`worktree-doctest-typecheck` branch mid-conversion, not the schedule),
10-22 (37, 29 of them `test/webapp/routes` + `test/webapp/trpc`). Every one
of the 389 files that failed only inside these runs is in the "ever failed"
total; the schedule classified those runs as environment and filed nothing.

### Top files by isolated-run failures (full runs)

Columns: runs = full runs that ran the file; fails = times failed; iso/mod/mass
= failures by run bucket; ep = episodes; longest = longest episode in runs;
flkF = ledger flakes in full runs; flkA = ledger flakes in all modes.

| file | runs | fails | iso | mod | mass | ep | longest | flkF | flkA |
|---|---|---|---|---|---|---|---|---|---|
| test/core/box/file-watcher.test.ts | 434 | 101 | 100 | 1 | 0 | 7 | 84 | 1 | 3 |
| test/scripts/release-manifest.test.ts | 258 | 27 | 27 | 0 | 0 | 3 | 21 | 0 | 0 |
| test/hub/hub-e2e.test.ts | 220 | 24 | 24 | 0 | 0 | 8 | 15 | 0 | 0 |
| test/frontend/lib/ui-scan/annotations.test.ts | 256 | 24 | 21 | 2 | 1 | 2 | 13 | 0 | 0 |
| test/hub/supervisor.test.ts | 484 | 25 | 17 | 7 | 1 | 20 | 3 | 0 | 6 |
| test/scripts/release.manifest.test.ts | 228 | 16 | 14 | 1 | 1 | 2 | 15 | 0 | 0 |
| test/core/pdf/extract.integration.test.ts | 228 | 14 | 12 | 1 | 1 | 5 | 9 | 1 | 1 |
| test/dev/launch-session.test.ts | 256 | 10 | 10 | 0 | 0 | 1 | 10 | 0 | 0 |
| src/frontend/test/lib/ui-scan.annotations.test.ts | 172 | 10 | 9 | 0 | 1 | 1 | 10 (open) | 0 | 0 |
| test/cli/lib/session.oversize-lines.test.ts | 228 | 9 | 8 | 0 | 1 | 5 | 4 | 0 | 0 |
| test/core/migrations.timeout.test.ts | 228 | 8 | 7 | 1 | 0 | 8 | 1 | 0 | 1 |
| test/webapp/trpc/routers/chat.hq-preferences.test.ts | 100 | 8 | 7 | 1 | 0 | 8 | 1 | 0 | 0 |
| test/core/landmark/landmark-schema.test.ts | 256 | 15 | 6 | 8 | 1 | 1 | 14 | 0 | 0 |
| test/core/loader-registry.test.ts | 484 | 15 | 6 | 8 | 1 | 1 | 14 | 0 | 0 |
| test/cli/commands/validate-box-checks.test.ts | 210 | 15 | 6 | 8 | 1 | 1 | 14 | 0 | 1 |
| test/core/migrations/one-root-migration.test.ts | 128 | 12 | 6 | 3 | 3 | 5 | 7 | 0 | 0 |
| test/cli/lib/session-retention.test.ts | 484 | 9 | 6 | 2 | 1 | 6 | 4 | 0 | 3 |
| test/core/migrations/one-root-move-plan.test.ts | 129 | 8 | 6 | 2 | 0 | 1 | 8 | 0 | 0 |
| test/cli/commands/view/command.test-command.test.ts | 228 | 8 | 6 | 1 | 1 | 3 | 6 | 0 | 0 |
| test/core/commands/pdf-extract-integration.test.ts | 263 | 6 | 6 | 0 | 0 | 1 | 6 | 0 | 0 |
| test/webapp/trpc-hq-preferences.test.ts | 51 | 6 | 5 | 1 | 0 | 6 | 1 | 0 | 4 |
| test/dev/workstream-list.test.ts | 256 | 5 | 5 | 0 | 0 | 1 | 5 | 0 | 0 |
| test/field-test/run.test.ts | 415 | 4 | 4 | 0 | 0 | 4 | 1 | 0 | 0 |
| test/lib/git-stale-lock.test.ts | 484 | 15 | 3 | 9 | 3 | 14 | 2 | 1 | 3 |
| src/frontend/test/lib/trpc/client.directory-resolution.test.ts | 143 | 5 | 3 | 2 | 0 | 4 | 2 | 0 | 0 |
| test/services/scan-vision-claude-integration.test.ts | 256 | 4 | 3 | 0 | 1 | 3 | 2 | 1 | 1 |
| test/core/migration-timeout.test.ts | 105 | 4 | 3 | 1 | 0 | 4 | 1 | 0 | 4 |
| test/theme-tour-installer.test.ts | 180 | 3 | 3 | 0 | 0 | - | - | 0 | 0 |
| test/dev/auto-sweep-detach.test.ts | 256 | 7 | 2 | 4 | 1 | 4 | 3 | 0 | 1 |
| test/frontend/trpc-directory-resolution.test.ts | 256 | 5 | 2 | 2 | 1 | 5 | 1 | 1 | 1 |
| test/hub/supervisor.maintenance.test.ts | 228 | 5 | 2 | 2 | 1 | 5 | 1 | 0 | 0 |
| test/webapp/trpc/routers.namespace-fence-traversal.test.ts | 227 | 4 | 2 | 1 | 1 | 4 | 1 | 0 | 3 |
| test/box-inventory.test.ts | 256 | 3 | 2 | 0 | 1 | - | - | 0 | 2 |
| test/core/capture/resume.test.ts | 375 | 3 | 2 | 0 | 1 | 3 | 1 | 0 | 3 |

The two shapes to read off this table:

- **Long single episodes** (release-manifest x21, hub-e2e x15, annotations
  x13 and x11, release.manifest x15, loader-registry / landmark-schema /
  validate-box-checks x14 each, launch-session x10, file-watcher x84): one
  event, re-counted every hour until someone edited the test. Almost all of
  these resolve to "the code changed on purpose and the test's expectation
  was stale" (section 2 and 4).
- **Many one-run episodes** (supervisor 20 episodes, git-stale-lock 14,
  migrations.timeout 8, chat.hq-preferences 8, connector-google-calendar 7):
  the file fails for one hour and passes the next with nothing changed. These
  are the timing/load files, and they are also the files with the highest
  ledger flake counts (supervisor 6, trpc-hq-preferences 4, migration-timeout
  4).

The ledger flake rule undercounts flakes on the schedule: a file that fails
at hour N and passes at hour N+1 is only a "flake" if no landing happened in
between (same commit and tree). On a busy main most hours see a landing, so
the 55 full-run flake events are a floor. The episode count is the better
flake proxy for schedule runs.

### Selected runs (developer iteration)

| measure | value |
|---|---|
| selected runs | 1401 (green 1051, red 350) |
| red selected runs: all failures attached / all unimplicated / mixed | 307 / 17 / 16 |
| failing-file records: attached / unimplicated / unknown | 1847 / 387 / 0 |
| files ever run in a selected run | 1983 |
| files that ever failed in a selected run | 661 |
| files that failed in selected but never in full | 344 (17% of all 2003 files; 36% of the 965 files that ever failed anywhere) |
| files that failed in full but never in selected | 304 |
| failed in both | 317 |

`attached` means the selection graph pointed at the file because of the
developer's own change; 94% of failing records on selected runs are attached.
Those are a developer breaking a test they are touching the code of (or
writing the test). The 344 "selected-only" failing files are tests that
caught something during development and never reached main red; the ledger
cannot say whether the developer fixed the code or the test.

Top selected-run failers (attached / unimplicated, with full-run failures
for contrast): file-watcher 32/0 (101 full), box-inventory 29/1 (3),
cli/lib/init 14/2 (1), supervisor 15/1 (25), one-root-migration 16/0 (12),
template-stock-hashes 15/0 (1), landmark-schema 13/1 (15),
validate-box-checks 12/1 (15), session-retention 11/1 (9),
trpc-chat-bootstrap 11/1 (0), agent-guide/lint 12/0 (1). The pattern:
fixture-snapshot tests (box-inventory, template-stock-hashes, landmark-schema,
file-watcher's directory listing) fail during iteration far more than they
fail on main, which is the selected-run doing its job: the developer sees the
stale snapshot before landing.

## 2. The red-main issues

### How a red episode is handled (schedules/full-suite)

`red.ts handleRed`: if more than 20 files failed, or a directory cluster
shares one first error, raise an environment alert and stop. Otherwise
`triage.ts` re-runs each failing file alone in the schedule's checkout; a
pass is a flake, and so is a fail when the ledger's flake share over the last
40 runs of that file is >= 0.25 (`KNOWN_FLAKE_SHARE`). Files already in the
known-red store are "red at baseline" and are not re-bisected. Up to 5 new
real failures are bisected over first-parent landings since the last tested
commit (`blameLanding`); a blamed landing must reach the file through the
import graph (`landingReachesFile`) or the file is "outside cone" and not
filed. One issue per blamed landing is written to `issues/bugs/` and
committed to main with the TAP excerpt (`fileIssues`). `alerts.ts` words the
alert so a flakes-only run reads "Nothing is broken."

The 2026-08-27 reports predate the known-red store and the cone check; the
loop issue (`2026-08-27-full-suite-report-loop-blames-its-own-commits.md`)
records that one real failure produced thirteen issues because each hourly
run bisected to the schedule's own previous report commit. The 2026-08-31
pair predate the slowdown gate and cone check and were both mis-attributed.

### Classification

Categories: (a) real regression caught; (b) intended change, stale test
updated; (c) flake / timing / environment / shared state; (d) test bug; (e)
infrastructure. "Dup" = superseded duplicate of another row.

| issue | date | test file(s) | class | supporting sentence |
|---|---|---|---|---|
| closed/bugs/2026-08-27-full-suite-red-drive-folder-mounts-1ae39b40 | 08-27 | test/frontend/lib/ui-scan/annotations | **a** | "real failure, correctly blamed. DriveSection.tsx authored `bbx-settings-drive-connect-google` in two mutually-exclusive branches; the error branch now has its own id." |
| 12 x closed/bugs/2026-08-27-full-suite-red-{02e2a02b,1383eece,21e33aca,2558d1aa,305a45ba,4c7719e0,531f560f,759dfd96,7edb9c73,95767092,d727e819,e2b6a313,f45c7f1c} | 08-27 | same file | dup of the row above | "one of twelve hourly duplicates of the first report — the schedule re-bisected the same annotations.doctest.md failure each hour and blamed its own previous report commit." (13 files counting 2558d1aa, which says "another hourly duplicate") |
| closed/bugs/2026-08-29-full-suite-red-install-remaining-dcdaa0eb | 08-29 | test/scripts/release-manifest | **b** | "The release-manifest fixture now includes the three source files deliberately added to the npm package for installed-box view typechecking." |
| closed/bugs/2026-08-31-full-suite-red-future-dated-issues-7f47b493 | 08-31 | test/frontend/trpc-directory-resolution | **c** (mis-attributed) | "That is machine contention, not the landing; the 'failed again in isolation' verdict was made on the same loaded machine. Mis-attribution by `schedules/full-suite/`." |
| closed/bugs/2026-08-31-full-suite-red-name-change-plan-def4435c | 08-31 | test/core/box/file-watcher | **c** (mis-attributed) | "A ~26-hour environmental condition on the host, blamed on whichever landing happened to be first in the window." |
| closed/bugs/2026-09-02-full-suite-red-view-live-update-state-e4ebb74d | 09-02 | test/cli/lib/git (now test/lib/git) | **d** (test-harness bug, correctly blamed) | "`374859ed1` (in the blamed landing) added `test/helpers/isolate-user-home.ts` to the tap preloads, so the global `init.defaultBranch=main` stopped applying and every bare `git init -q` in a test helper produced `master`. Fixed by passing `-b main` explicitly" |
| closed/bugs/2026-09-05-full-suite-red-box-layout-criteria-e958d8fe | 09-05 | test/core/migrations/one-root-migration, one-root-move-plan | **b** | "`009e00eec` (same workstream) had since made unknown plain directories map into `_content/` by design — so nothing threw and the test died on `err.message`. The fixture is now a dotfile entry" |
| closed/bugs/2026-09-10-full-suite-red-interface-as-cards-0cb160c0 | 09-10 | test/core/box/file-watcher | **b** | "the watcher correctly includes the newly seeded `_config/interface` directory. The doctest's `SKELETON_DIRS` omitted that standard directory, making four exact directory-list assertions fail. Added it to the fixture baseline" |
| closed/bugs/2026-09-11-full-suite-red-f859fbd7 | 09-11 | validate-box-checks, landmark-schema, loader-registry, trpc-presentation | **b** (3 files); 4th green by itself | "The blame was right and the production change was right: `f859fbd7` made theme names and stocks an open set, so three of these four files were asserting the old catalog-allowlist behaviour." |
| closed/bugs/2026-09-15-full-suite-red-glm-v2-layout-64cad1b8 | 09-15 | chat/session/reserve, command-streaming, commands/answer-command | **c** | "diagnosed as load-contention timeouts, not a defect ... The landing was blamed because it was newest and graph-reachable; the trigger was two test batteries sharing the host." |
| closed/bugs/2026-09-15-full-suite-red-migration-reliability-ba7121b7 | 09-15 | test/hub/hub-e2e (+ test/manual/chat-queue-real recurrence) | **b** with a side finding: the test discarded the diagnostic | "`makeFixtureBox` built the box with `initBox(boxRoot, { skipGit: true })`, on the stated premise that Git is 'irrelevant to HTTP serving'. `ba7121b7` made that premise false" and "No engine change was needed." |
| closed/bugs/2026-09-16-full-suite-red-search-card-25048957 | 09-16 | test/box-inventory, test/core/migration-gitignore | **b** | No closure sentence in the issue; closed by commit `3b3df966a` "test: update counts for seeded search card" (two one-line count edits). |
| closed/bugs/2026-09-17-full-suite-red-secret-endpoint-derivation-b301ecf6 | 09-17 | test/box-inventory, test/cli/lib/init | **c** (unexplained, did not reproduce) | "no longer reproduces. Both files pass at `d11498926` and later ... 17/17 alone twice and three times under 8 CPU hogs. Neither has failed in the ledger's later full-suite records." |
| closed/bugs/2026-09-21-full-suite-red-feedback-as-cards-2e788ee9 | 09-21 | test/core/box/file-watcher | **b** | "the feedback-as-cards landing added `_config/feedback` to the box scaffold. Fixed there." (the fix, `50961ada5`: "The doctest now derives its skeleton set from a fresh box's watcher instead of a hand list, so later scaffolding cannot make it stale.") |
| closed/bugs/2026-09-27-full-suite-red-notifications-9b58dc80 | 09-27 | test/webapp/trpc-hq-preferences | **a** (nondeterministic product race) | "Cause: a real lost update in the reserved-chat feature handoff ... Toggling the moment the seed was visible lost it 20/20 times." |
| closed/bugs/2026-10-06-full-suite-red-card-view-fixes-c71e1344 | 10-06 | test/webapp/trpc/routers/chat.hq-preferences | **a** x2 runs, **c** x6 runs; file later deleted | "They show two mechanisms: ... a lost toggle ... That race in the product was fixed by f1ba1944e" and "The other six: a `waitFor` with a 10s deadline after the send timed out while the run's bootstrap git commit ... was still in flight. This is load, not a red." |
| closed/bugs/2026-10-06-full-suite-red-codex-plugin-hooks-5d7a909f | 10-06 | test/cli/lib/session.oversize-lines | **c** (mis-attributed) | "Not caused by the codex-plugin-hooks landing: the test was a flake near its heap cap that failed about half the time." |
| closed/bugs/2026-10-13-full-suite-red-siri-app-intents-949f78e6 | 10-13 | test/core/capture/resume | **a** (process-lifetime bug) | "The new pending session-identity observer held a referenced ten-minute interval. The fake backend never assigned an identity, so the assertions passed but Node did not exit." |
| closed/bugs/2026-10-15-full-suite-red-busy-send-rejection-97bead0a | 10-15 | test/webapp/routes/chat.send-fast-ack | **b** | "The busy-send change made the route ack only after the session admits a send; the doctest parked `send()` before admission, so the ack never came. The gate now parks the engine start." |
| bugs/2026-10-22-ui-scan-annotations-test-red-after-app-bar-faces (open) | 10-22 | src/frontend/test/lib/ui-scan.annotations | **b** (pending; 10 runs red and counting) | "Either the expected table needs the new locations, or the faces should keep the annotation where the test expects it; the owner of that change decides which." |

Counts over the 19 distinct episodes (31 closed files + 1 open, minus 12
duplicates, counting the card-view-fixes issue once):

| class | episodes | files involved |
|---|---|---|
| (a) real regression caught | 4 | annotations (08-27), trpc-hq-preferences (09-27, and 2 of the card-view-fixes runs), capture/resume (10-13) |
| (b) intended change, stale test updated | 9 | release-manifest, one-root-migration + move-plan, file-watcher (x2: interface, feedback), the f859fbd7 trio, hub-e2e fixture, box-inventory + migration-gitignore, chat.send-fast-ack, ui-scan.annotations (open) |
| (c) flake / load / environment / unexplained | 6 | trpc-directory-resolution, file-watcher (08-31), the glm-v2-layout trio, box-inventory + init (09-17), session.oversize-lines, chat.hq-preferences (6 of 8 runs) |
| (d) test-harness bug | 1 | test/lib/git (preload changed git's default branch for every helper) |
| (e) infrastructure | 0 | - (the 08-27 duplicate loop and the 08-31 mis-attributions are schedule bugs, filed separately as full-suite-report-loop and fixed-timeout-budgets) |

Of the 6 class-(c) episodes, 4 were explicitly mis-attributed by the
schedule to an innocent landing (both 08-31 reports, codex-plugin-hooks, and
glm-v2-layout: "blamed because it was newest and graph-reachable"). After the
slowdown gate and cone check landed (full-suite-verdicts, early September),
the only mis-attributions are oversize-lines (10-06, heap-cap flake) and the
glm-v2 one (09-15).

### Long episodes in the ledger that have no `full-suite-red` issue

These are the other long single episodes from section 1, traced through git:

| file | episode | what it was | class |
|---|---|---|---|
| test/scripts/release-manifest | 09-06..09-08 x21, 09-27 x4 | commits `fcaf01345` "fix: release-manifest doctest learns docs/box" and `ae0f69ee3` "Release manifest doctest: expect the agent-guide files in package.json" | b |
| test/scripts/release.manifest | 10-10..10-12 x15 | `5926c40c2` "release.manifest doctest: drop the files-list snapshot, expand globs in the existence check" | b (snapshot test rewritten to stop being a snapshot) |
| test/dev/launch-session | 09-03..09-04 x10 | `2ccdcf4cc` "test: launch-session expects the Codex lease cleared before the agent starts" | b |
| test/frontend/lib/ui-scan/annotations | 09-09..09-10 x11 | issue `2026-09-09-ui-scan-annotations-table-lists-two-absent-ids`: "The workspace redesign removed the companion-wide close control, so its old `bbx-panel-close` contract entry has been removed." Filed by the sdk-update schedule because the full-suite run "classified itself as '25 files failed (environment)' and filed nothing." | b |
| same | 09-21..09-23 x13 | `a7a951679` "test(ui-scan): expect bbx-nav-questions in the plan's id table" | b |
| test/dev/workstream-list | 09-14..09-15 x5 | issue `2026-09-15-test-selection-cannot-see-bin-shell-scripts`: "A change to a `bin/` shell script selects no tests and can be blamed for no failure." | b for the test, e for why it reached main (selection graph blind to `bin/` scripts) |
| test/core/pdf/extract.integration | 10-02..10-04 x9 | issue `2026-10-02-docling-integration-times-out-instead-of-skipping`: "it failed with a tap `timeout!` instead (289 s" on a slow network link; fixed by running offline | c (environment) + d (the skip guard did not guard) |
| test/cli/commands/view/command.test-command | 10-19..10-20 x6 | `6d0ec43f7` "Fix: view test-command expects the todo text's card ink class" | b |
| test/hub/hub-e2e | 09-17..09-18 x15 | `d09451cd6` "test(hub): spawn the hub under its renamed engine verb" (the migration-reliability fixture fix came just before) | b |
| test/core/box/file-watcher | 09-21..10-06 x84 | the feedback-as-cards row above; sat red for 15 days until test-suite-health fixed it | b |

## 3. Flake issues

`grep -ril flak issues/` returns 70 files. 37 are about an intermittently
failing test (plus the umbrella issue
`closed/bugs/2026-10-08-fix-or-eliminate-every-flaky-test.md`); the other 32
mention the word in passing (browser-tool flakiness, triage tooling, retros).
None of the 37 is still open. Root causes as each issue states them:

| root cause | n | issues |
|---|---|---|
| test bug (wrong assertion, fixture, or wait) | 11 | hub-router hangs (07-10), run-target (08-02), file-watcher timing (08-03), file-watcher event count (08-08), bulk-upload cancel (08-13), auto-sweep-detach (08-24), schedules process-group (08-25), annotations absent ids (09-09), namespace-fence-traversal (09-29), supervisor failed-reload (10-06), ios box-screen retry (10-17) |
| timing / timeout under host load | 10 | hub-e2e (07-20), view-check (08-05), box-growth (08-06), exec-with-timeout (08-20), chat-send polling (08-23), concurrent-worktree timeouts (08-24), router-core shutdown (08-24), extreme-parallel timeouts (08-24), webapp auth timeouts (08-25), fixed-timeout-budgets (09-02, consolidates three of these) |
| environment / tooling (tap plugins, tsx loader, heap cap, HOME, network, framework) | 9 | doctest source pointer (08-05), tsx loader (08-05), file-watcher suite timeout (08-06, "the root cause was in the doctest framework, not in the watcher"), fresh-checkout tap plugins (08-25), chat-queue-real HOME (09-08), inject-email timeout (09-15), docling offline (10-02), oversize-lines heap cap (10-02), session-retention heap cap (10-07) |
| real product bug the flake exposed | 4 | child-output-log (07-09, "an in-process async race"), chat-default-route tmpdir (08-08, background work "did not attach ... to Fastify's shutdown lifecycle"), git-lock (08-18, "Each test raced something real, and each race is reproducible on an idle machine"), hub readiness limit (10-12, closed wontfix: "not observed outside tests") |
| port collision | 1 | hub-e2e fixed port across worktrees (08-14) |
| unknown, closed wontfix after failed reproduction | 2 | mobile-spa-fallback (07-10), login-redirect (07-29) |

Recurrent flake files (named in two or more flake issues):
`test/core/box/file-watcher` (5 issues + umbrella), `test/hub/hub-e2e` (4 +
umbrella), `test/hub/supervisor` and `supervisor.maintenance` (4 + umbrella),
`test/field-test/run` (3 + umbrella), `test/dev/auto-sweep-detach` (3 +
umbrella), `test/cli/lib/session-retention` (2 + umbrella),
`test/cli/lib/session.oversize-lines` (2 + umbrella), the `test/frontend/*`
group and `trpc-directory-resolution` (3), `test/webapp/login-redirect` (2 +
umbrella), `test/webapp/mobile-spa-fallback` (2 + umbrella).

What the umbrella issue (2026-10-08, closed 10-19) concluded:

- Over 855 hourly runs, 49 files had failed in a run with at most five
  failures; leaders were file-watcher (89), ui-scan/annotations (33),
  release-manifest (28), hub-e2e (17). These match the ledger counts in
  section 1 (the ledger here runs two weeks longer).
- It changed the counting rule to "a flake only when the runs on either side
  passed the file", and under that rule release-manifest "was never a flake":
  the test snapshotted `package.json` `files` and went red each time that
  list changed. That is the stale-snapshot shape of section 2.
- Each recurring file was traced to a specific mechanism, not to load alone:
  supervisor "asserted a closure that had been removed"; supervisor.maintenance
  exceeded the hub's 30 s `READY_TIMEOUT_MS` on a cold boot; git-stale-lock ran
  a machine-wide `lsof` that timed out; migrations.timeout's budget "also
  covered setup"; session-retention's fixture "no longer told the cases
  apart"; file-watcher now uses an injected watcher; hub.e2e's shutdown wait
  was shorter than the hub's kill window and ran a frontend build inside the
  test; four chat files had an unawaited bootstrap commit outliving cleanup.
- Product fallout from the sweep: chat shutdown now waits for a send that is
  still opening its turn ("the product cause of four chat flakes"), and the
  hub readiness limit was filed as its own issue.
- Deleted outright: ui-scan/annotations (the old doctest; the `.test.ts`
  under `src/frontend/test` is its replacement and is the one red today),
  one-root-migration, one-root-move-plan.
- The two field-test files stay in `careful.txt` because "making them
  deterministic would mock away what they test"; git-lock stays out with no
  code change ("No mechanism was found"); 23 one-off files closed as "no
  recurrence" with 68 to 315 passing runs since their last failure.

The repeated finding across the flake issues: a failure first filed as
"load" usually had a mechanism in the test. From the 08-18 supervisor/git-lock
issue: "A flake that only appears under load is still a flake with a
mechanism." From the fixed-timeout-budgets issue's 10-18 section: the
recurring files were "traced to a test-caused timing dependence, not to load
alone."

## 4. Reading: which tests earned their keep by failing

What the data supports:

**Caught a real regression on main at least once (named issue):**

- `test/frontend/lib/ui-scan/annotations.test.ts` (now
  `src/frontend/test/lib/ui-scan.annotations.test.ts`): duplicate id authored
  in two branches of `DriveSection.tsx`, issue
  `2026-08-27-full-suite-red-drive-folder-mounts-1ae39b40`. The same file is
  also the most-often-stale test in the repo (three other episodes, all
  "update the expected table"), and it is red on main right now for that
  reason.
- `test/webapp/trpc-hq-preferences.test.ts` /
  `test/webapp/trpc/routers/chat.hq-preferences.test.ts`: a real lost update
  in the reserved-feature handoff, reproduced 20/20 under a targeted toggle,
  issues `2026-09-27-full-suite-red-notifications-9b58dc80` and
  `2026-10-06-full-suite-red-card-view-fixes-c71e1344`. The same file also
  failed six times on a 10 s `waitFor` under load, and was deleted on
  2026-10-09 when the feature went away.
- `test/core/capture/resume.test.ts`: a referenced ten-minute interval kept
  Node alive after the assertions passed, issue
  `2026-10-13-full-suite-red-siri-app-intents-949f78e6`. Note the shape: the
  test's assertions did not catch it; the process not exiting did.
- `test/lib/git.test.ts` (class d, but the finding was real): a preload added
  by the landing changed every helper's `git init` default branch; the fix
  was in the helpers, not the product.

That is 3 product regressions caught by the hourly schedule in 54 days and
~960 full runs, against 9 stale-expectation episodes and 6 load/environment
episodes. The selected-run ledger shows another 344 files that failed only
during development and never on main; the ledger cannot say which of those
were regressions caught before landing versus tests being written.

**Failed only because the code changed on purpose (test needed updating):**
release-manifest / release.manifest (3 episodes, 42 red hours),
file-watcher's directory listing (2 episodes, 87 red hours, until the test
was rewritten to derive the listing from a fresh box), one-root-migration +
one-root-move-plan, loader-registry + landmark-schema + validate-box-checks
(the theme open-set change), hub-e2e's gitless fixture, box-inventory +
migration-gitignore (seeded search card counts), chat.send-fast-ack,
launch-session, workstream-list, view/command.test-command, and the three
later annotations episodes. The common form is an exact snapshot of a
generated set (directory listing, package file list, inventory counts, id
table) that any deliberate scaffold change invalidates.

**Failed only as flakes / load / environment in full runs (no regression
ever attributed):** test/hub/supervisor.test.ts (20 one-run episodes, 6
ledger flakes), test/lib/git-stale-lock.test.ts (14 episodes),
test/core/migrations.timeout + migration-timeout (12 episodes across the
rename), test/connectors/connector-google-calendar (7),
test/cli/lib/session-retention (6, heap cap), test/cli/lib/session.oversize-lines
(5, heap cap), test/core/pdf/extract.integration (5, Docling offline),
test/frontend/trpc-directory-resolution + src/frontend/.../client.directory-resolution
(9 across the rename, child-loader timeouts), test/dev/auto-sweep-detach (4),
test/dev/worktree-create-concurrency (4), test/field-test/run (4),
test/core/docs-refresh (5), test/core/annex/doctor (5),
test/hub/supervisor.maintenance (5), test/core/procedure/procedure-engine (6).
None of these has a red issue that ends in a product fix. The flake issues
(section 3) add that most of them had a mechanism in the test, and that four
flake investigations in the pre-ledger period did reach a product fix:
`test/hub/child-output-log` (async write race in `rolling-log.ts`),
`test/webapp/chat-default-route` (background work not tied to Fastify
shutdown), `test/lib/git-lock` (in-flight promise not cached), and the
chat-shutdown wait found by the 10-08 sweep. So "flaky" tests paid off four
times in July-October, each time through an investigation, never through the
red run itself.

**What the data cannot tell:**

- Whether a selected-run attached failure was a caught regression or a test
  under construction; the ledger records the class, not the outcome.
- Whether the 389 files that failed only inside mass-red runs ever failed
  for a reason of their own; the schedule files nothing for those runs.
- How many flakes the schedule's own triage absorbed silently: a
  flakes-only run raises an fyi alert and writes no issue, and the alert store
  is not in this repo. The ledger's flake rule needs an identical commit, so
  on a busy main most hour-to-hour fail/pass pairs are invisible to it.
- The pre-ledger period (before 2026-08-30): the August red issues and all
  July/August flake issues have no run counts behind them.
- Anything about tests that never failed: 1326 files (68%) have no failure
  in 959 full runs, and this dataset says nothing about whether they would
  catch a change.
