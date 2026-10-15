# Sweep: quality gates and verification

Repo baseline: 8,778 commits on this branch (`git rev-list --count HEAD`), first commit 2026-01-27 feb42fed4. Several packages were merged into the monorepo on 2026-05-26 (085a23011, 43fc5762e); their earlier history survives, so some "Appeared" dates predate the merge.

Machine-local instruments read for aggregate counts only (not tracked in git): the test ledger `<git-common-dir>/beebox-test-ledger.jsonl` (plus the pre-rename `callback-test-ledger.jsonl`) and the smoke log `<git-common-dir>/beebox-smoke-log.jsonl`.

---

## Doctest framework (agent-doctest, `.doctest.md`)
- **One line:** Markdown files whose fenced TypeScript examples (`expr => value`) run as TAP tests; the default test form in this repo.
- **Lives in:** `agent-doctest/` (src, `docs/syntax.md`, `docs/check-reference.md`, `docs/getting-started.md`); `.claude/skills/doctest/SKILL.md` (65 lines); `beebox/docs/testing/doctests.md`; `beebox/docs/testing.md` ("Doctests are the default"); `beebox/CLAUDE.md` ("Doctests are the default test form").
- **Appeared:** 2026-03-03 aa13e9c98 "Add doctest support: run markdown files as tap tests"; same day 257c2be03 "replace paths.test.ts with doctest". Extracted as a package 2026-03-09 1739e4c9e "Initial extraction of agent-doctest from <old-package>". Key reshapes: 2026-06-09 3aecb4c05 "agent-first tap output + doctest template-literal support" (tap reporter=tap, color=false because "the consumers of test runs are agents reading through a pipe"); 2026-09-28 46a02a09f "Prototype doctest usability changes: errors as TAP tests, line maps, make-it-work parsing, wildcard suggestions" (from a usability review run with agents; on main; plan moved to implemented 2026-10-02 b71be3709). Skill: earliest add found 2026-08-03 e52071dfb "skills: review pass — ... add missing skills".
- **Bottleneck relieved:** Tests as documentation an agent can read and write without a harness. `beebox/docs/testing.md`: "Tests as literate documents that tell a story about how things work. Doctests are the primary format: readable markdown that happens to be executable." and "TAP over fancy test runners. TAP's text protocol is agent-readable and zero-dependency."
- **New bottleneck exposed:** Volume and run time. With ~1,000 doctests the whole suite became too slow/contended and too often red for reasons unrelated to the branch (see change-based selection, hourly full suite). Authoring friction surfaced as a usability review (issue `2026-09-27-doctest-usability-review`, commit 46a02a09f). Flakes from fixed sleeps and timing budgets (skill: "Most past flakes were test-caused: a fixed sleep or an unsettled wait").
- **Evidence:**
  - 1,035 tracked `.doctest.md` files, 172,174 lines: `git ls-files '*.doctest.md' | wc -l`; `git ls-files -z '*.doctest.md' | xargs -0 cat | wc -l`.
  - By package: beebox 950, bin 32, workstreams-app 32, scan-uploader 14, browse 5, agent-doctest 2: `git ls-files '*.doctest.md' | cut -d/ -f1 | sort | uniq -c`.
  - Compare 142 `*.test.ts(x)` files, 21,554 lines: `git ls-files '*.test.ts' '*.test.tsx' | wc -l` (and `| xargs cat | wc -l`).
  - Doctest file additions by month (A-status only; renames not counted, so sums to 809 not 1,035): 2026-03 27, 04 11, 05 28, 06 79, 07 180, 08 233, 09 199, 10 52: `git log --diff-filter=A --format='%ad' --date=format:%Y-%m -- '*.doctest.md' | sort | uniq -c`.
  - 38 commits touch `agent-doctest/`: `git log --oneline -- agent-doctest | wc -l`. 10 commits touch the skill.
  - Skill usage over 60 days: 6 Claude sessions (subagents), 7 Codex focused sessions (`dev/skills-review-2026-10.md` table).
- **Outcomes:** Still the primary test form; 950 doctests in beebox against 142 `.test.ts` files repo-wide. Every other test instrument in this sweep (ledger, selection, careful tier, full-suite bisection) is built over doctest files. The test ledger has recorded 1,915 completed runs over 1,823 distinct files (`node --import tsx bin/test-ledger.ts report`). The usability work changed failure output to name markdown lines and give paste-ready `suggested:` values (46a02a09f). Judgment: the format is the base the later verification layers sit on; its cost is the flake load documented in the ledger (717 files have ever failed in some run).
- **Prior-art mention:** meta-practices.html yes ("doctest framework — markdown files that run as tests — docs that can't go stale", dated 2026-03-03); skills-review yes (merge doctest with bbx-guide-testing; flake paragraph contradicts finish.md); workstream-story.md no; agent-knowledge.html no.

## Change-based test selection (`pnpm test:changed`)
- **One line:** Runs only the tests whose import graph (derived with esbuild) reaches the branch's changed paths; unaccounted paths run everything.
- **Lives in:** `bin/test-select.ts`, `bin/test-git.ts`, `beebox/package.json` (`test:changed`), `beebox/docs/plans/change-based-test-selection.md` (+ `.review.md`), `beebox/CLAUDE.md` ("Use `pnpm test:changed`").
- **Appeared:** Design 2026-08-08 4f9001b62 "docs(plans): design change-based test selection"; graph 2026-08-09 4f8ad1a26 "feat(bin): derive the test->source import graph (Track 1)"; selector 2026-08-25 088046895 "feat(test-select): change-based selection, and a content-based tree hash"; 2026-08-25 b0131e03a "docs(plan): test-economics revision — semaphore, permissive selection, careful tier, hourly batched full run"; 2026-10-06 01f482e9d "Test selection: match bin/ scripts by unit through spawn edges".
- **Bottleneck relieved:** Full-suite runs on every iteration and at merge. `beebox/docs/testing.md`: "There is no full run at merge: full runs were mostly red for reasons the branch did not cause." Origin issue: `issues/closed/exploration/2026-08-08-run-less-of-the-test-suite.md`.
- **New bottleneck exposed:** Coverage holes became visible: the plan records "25% of real branches are fully accounted for, against a bar of 50%" and "if three quarters of branches touch code no test imports, running 484 tests for them is not verification, it is ritual". Spawned `issues/code-quality/2026-08-09-src-untested-by-import.md`. Moved main-branch verification to the hourly full suite.
- **Evidence:** Ledger: 1,217 `selected`-mode runs since 2026-08-30, 414 of them with `accounted: true` (34%), 803 not (python count over `beebox-test-ledger.jsonl` grouping by `mode` and `accounted`). bin/test-select.ts: 7 commits (`git log --oneline -- bin/test-select.ts | wc -l`).
- **Outcomes:** In daily use (it is the documented iteration command and what `bin/finish-verify` runs). Commit 69414cfbe (2026-09-27) "Layout moves: fix stale scripts/ paths surfaced by test:changed" is one recorded catch. The plan states the measured gate failed and the project was reframed around the ledger. Judgment: its main product was the measurement that most changes touch untested code, which redirected effort to the ledger and the full-suite schedule.
- **Prior-art mention:** none of the four docs.

## Test ledger (`bin/test-ledger.ts`)
- **One line:** Appends one JSONL record per test run (green included) to the git common dir, classifying failures as attached, missed (unimplicated), or flaky.
- **Lives in:** `bin/test-ledger.ts`, `bin/test-ledger-lib.ts`, `bin/test-ledger-store.ts`, `bin/test-ledger-report.ts`; wrapped into `pnpm test` / `pnpm test:careful` in `beebox/package.json`; plan Track 5.
- **Appeared:** 2026-08-09 d74af7a14 "feat(bin): the test failure ledger (Track 5a)"; 2026-10-06 bf5cda987 "Test ledger: record frontend and bin doctest results".
- **Bottleneck relieved:** No data about which failures mattered. Plan: "it answers a question this repo cannot currently answer: which tests have ever failed in a way that mattered?" and "Green runs are recorded too — they are the denominator".
- **New bottleneck exposed:** It made the flake load measurable (see careful tier, issue `issues/bugs/2026-10-08-fix-or-eliminate-every-flaky-test.md`).
- **Evidence:** `node --import tsx bin/test-ledger.ts report`: 1,915 runs recorded, 1,823 files seen, 717 files ever failed; worst file `test/core/box/file-watcher.doctest.md` 124 failures / 398 runs, 75 unimplicated. Raw rows: 2,208 (beebox ledger, 2026-08-30 to 2026-10-09) + pre-rename callback ledger (2026-08-09 to 2026-08-30): 869 rows (`wc -l`, python grouping). bin/test-ledger.ts: 16 commits.
- **Outcomes:** In use; its `report` prints careful-tier candidates, and careful.txt comments cite its numbers ("29 failures / 365 runs, 10 derived flakes"). Provides the flake definition used by `bin/finish-verify` ("fail-then-pass at the same content hash"). Judgment: an instrument with no gate, used to justify each later flake-policy change.
- **Prior-art mention:** skills-review yes (one mention: careful.txt as the flake channel); others no.

## Careful tier and flake quarantine (`beebox/test/careful.txt`)
- **One line:** A hand-curated list of timing-sensitive test files that are excluded from selected runs and run alone, `-j1`, in the batched full run.
- **Lives in:** `beebox/test/careful.txt`, `pnpm test:careful`, `bin/test-ledger.ts --tier careful`, `.claude/agents/finish.md` ("no flake issue (`beebox/test/careful.txt` owns curation)").
- **Appeared:** 2026-08-25 80954db6a "feat(test-select): spawner refs become edges, and a careful tier". 5 commits since.
- **Bottleneck relieved:** Flaky files blocking unrelated work. File header: "They are not deleted for being a nuisance; they run less often and more carefully." and "Membership is a judgment, not an automatic demotion."
- **New bottleneck exposed:** Quarantine without elimination. `issues/bugs/2026-10-08-fix-or-eliminate-every-flaky-test.md` (open): "49 doctest files have failed in a run where at most five files failed ... The goal is that list going to zero." Also a policy contradiction: skills-review item 5, "Flake policy contradicts finish.md".
- **Evidence:** 6 files listed (`grep -vc '^#\|^$' beebox/test/careful.txt`). Ledger report: all 6 at 0% flake share in their last 40 runs.
- **Outcomes:** Still in use; ledger shows all 6 quarantined files at 0/40 recent failures. The open issue above shows the quarantine approach is being replaced by a fix-or-delete pass. Judgment: it stopped flakes from blocking landings but did not reduce the flake count.
- **Prior-art mention:** skills-review yes (contradiction note); others no.

## Flake handling policy ("never rerun to chase green")
- **One line:** A failing file is rerun once in isolation; passing alone at the same content hash is a named flake (green, reported); failing again blocks; no suite rerun.
- **Lives in:** `.claude/agents/finish.md` §3, `bin/finish-verify.ts` header, `.claude/skills/doctest/SKILL.md` "Flake triage", `beebox/CLAUDE.md` ("do not dismiss it as pre-existing without evidence").
- **Appeared:** 2026-08-25 803ff20fa "feat(finish): scripts for the landing, and a 150-line agent file" (first commit containing "chase green": `git log -S'chase green'`). Earlier flake work: 2026-05-27 efb853c95 "Quiet test output + fix recurring @tapjs/core resolution flake"; 2026-06-09 3aecb4c05 fixed the "alternating 'no tests found' / ERR_MODULE_NOT_FOUND flakes".
- **Bottleneck relieved:** Agents rerunning suites until green, or dismissing failures as pre-existing. finish.md: "Red means fix and recheck or BLOCKED with the output path, never a suite rerun to chase green."
- **New bottleneck exposed:** Doc drift between skill and agent file (skills-review item 5: doctest 61-64 and bbx-issue-actions 154-155 still say to rerun and file flake issues).
- **Evidence:** 90 commits mention "flake" in message (`git log -i --grep='flake' --oneline | wc -l`), 48 in subject (`git log --format=%s | grep -ic flake`). By month: 2026-05 2, 06 3, 07 8, 08 56, 09 12, 10 9 (`git log -i --format='%ad' --date=format:%Y-%m --grep='flake' | sort | uniq -c`). 5 issues have "flak" in discovered-in.
- **Outcomes:** In use in every /finish run (finish skill typed in 128 Claude sessions over 60 days per skills-review). The August spike in flake commits (56) coincides with the ledger and full-suite landing. Judgment: the rule moved flake decisions from agent discretion to a scripted single rerun.
- **Prior-art mention:** skills-review yes (contradiction); others no.

## Hourly full suite with bisection (`schedules/full-suite`)
- **One line:** An hourly scheduled job runs the whole beebox suite on `main` in a detached worktree when anything landed, bisects a red batch over first-parent landings, files one issue per blamed landing, and alerts.
- **Lives in:** `schedules/full-suite/` (`schedule.yaml`, `run.ts`, `batch.ts`, `red.ts`, `attribution.ts`, `triage.ts`, `trust.ts`, `alerts.ts`), `bin/schedules`, `bin/host-pressure.ts`.
- **Appeared:** 2026-08-25 b88d84861 "feat(schedules): full-suite runs main hourly and bisects red to the landing". Reshapes: 2026-08-27 65cad1b48 "stop repeat full-suite red reports"; 2026-09-02 2a7e19379 "load-gate verdicts, cone-check attribution, dedupe alerts"; 2026-09-11 b47af3add "gate on memory pressure, defer instead of running loaded"; 2026-10-06 374284c3a "Full suite: gate on swap, pageout rate and warn pressure; one full run at a time".
- **Bottleneck relieved:** Removing full runs from merge left `main` untested. `schedule.yaml`: "the only thing that tests `main`, and the only thing that still runs everything ... a failure that reaches main surfaces here within the hour." Run-only by design: "every step of that is derivable, so an agent session would only add cost and a place to be creative."
- **New bottleneck exposed:** (1) Report loop: it blamed its own report commits, producing hourly duplicates (`issues/closed/...full-suite-red-...` "one of twelve hourly duplicates"; filed as `2026-08-27-full-suite-report-loop-blames-its-own-commits`). (2) Host load faking reds (`issues/bugs/2026-09-02-fixed-timeout-budgets-fail-under-host-load.md`), leading to memory/swap gating. (3) Flake volume (the 2026-10-08 flaky-test issue).
- **Evidence:** 855 hourly runs 2026-08-25 to 2026-10-08, 240 failed, 135 on exactly one file (quoted from `issues/bugs/2026-10-08-fix-or-eliminate-every-flaky-test.md`, derived from the schedule's run logs outside the repo). Ledger: 922 `full` runs on main/detached HEAD since 2026-08-30, 511 non-zero exit (python grouping; includes bisect re-runs). 29 `full-suite-red` issues filed (`git ls-files issues | grep -c full-suite-red`): 17 in 2026-08, 10 in 09, 2 in 10; resolutions 11 implemented, 16 superseded, 1 wontfix, 1 open. 38 issues have full-suite in discovered-in, 35 closed. 13 commits reference a full-suite-red issue (`git log -E --grep='full-suite-red' --oneline | wc -l`). `bin/schedules list`: last outcome clean.
- **Outcomes:** Running (last run "clean", 2026-10-09). Caught 11 regressions that were fixed (the 11 "implemented" full-suite-red issues), e.g. 0e37ecba0 "fix(test): give the hub-e2e fixture box the Git repository it now needs", 6f5197c9c "field-test doctest follows the model-policy landing". Its run data produced the 49-file flake list. Judgment: it made "no full run at merge" safe enough to keep; most of its alerts in its first weeks were duplicates or load artifacts (16 superseded).
- **Prior-art mention:** none of the four docs.

## `bin/finish-verify` and finish preflight
- **One line:** Script that runs exactly the checks the finish decision sheet names (tests, typecheck, lint, smoke, site) and prints `VERDICT: green|red`.
- **Lives in:** `bin/finish-verify.ts`, `bin/finish-preflight.ts`, `bin/finish-preflight-lib.ts`, `.claude/agents/finish.md`, `.claude/skills/finish/SKILL.md`.
- **Appeared:** 2026-08-25 803ff20fa "feat(finish): scripts for the landing, and a 150-line agent file". finish subagent: 2026-07-03 42d39875c "chore(claude): run /finish in a subagent". 
- **Bottleneck relieved:** Landing verification as agent prose. Header: "answers the one question `/finish` needs: green or red."
- **New bottleneck exposed:** Not visible beyond the flake-policy drift above.
- **Evidence:** 7 commits on bin/finish-verify.ts. Skills-review: finish typed in 128/129 Claude sessions; "`land` or finish-preflight refused 53/20 ... by design".
- **Outcomes:** In use on every landing. Judgment: moved verification choices from agent text into a script.
- **Prior-art mention:** skills-review yes (finish usage counts); others no.

## Manual-testing confirmation (`bin/confirm-tested.ts`) and manual-tests schedule
- **One line:** Issues needing human testing carry `needs: manual-testing`; `confirm-tested` closes them; a weekly schedule runs `pnpm test:manual` and triages results into issues.
- **Lives in:** `bin/confirm-tested.ts`, `schedules/manual-tests/`, `beebox/package.json` `test:manual`.
- **Appeared:** 2026-08-09 fd1299085 "Add manual testing workflow"; schedule 2026-08-24 00bbd508d "schedules: enroll manual-tests (Track F)".
- **Bottleneck relieved:** Verification that needs the boxholder or real accounts had no tracking.
- **New bottleneck exposed:** Not visible.
- **Evidence:** 4 commits on confirm-tested.ts; 5 on the schedule dir; 3 issues have "manual-test" in discovered-in. `bin/schedules list`: manual-tests weekly, last outcome clean.
- **Outcomes:** Running weekly; e.g. e19a43adf "docs(issues): weekly manual-test triage 20260915-204151". Judgment: low volume.
- **Prior-art mention:** no.

## Smoke tier (`bin/smoke`) and smoke-review schedule
- **One line:** Before a merge touching deployed paths, boots a real box through the dev router and walks it in a browser (chat shell, place menu, /browse, open a card, no page errors); no model turns; logs every step.
- **Lives in:** `bin/smoke*.ts`, `beebox/docs/testing/smoke.md`, `schedules/smoke-review/`, `beebox/deploy/deploy.sh` (post-deploy half: `/healthz`, `/healthz/canary`, dist assertion).
- **Appeared:** 2026-08-26 1e8cfe8c4 "feat(tests): a smoke tier that boots a real box and walks it before a merge"; 2026-08-26 934be1385 "log every smoke run per step, so the tier can be trimmed on evidence"; 2026-08-26 a5e8e624c "feat(schedules): weekly review of the smoke tier's shape"; 2026-08-26 92c74000e "fix(tests): close the two false greens a cross-model review found in the smoke tier".
- **Bottleneck relieved:** Selected tests passing while the app was broken. Commit 1e8cfe8c4: "Three escapes on 2026-08-25/26 passed typecheck, lint and their selected tests while the app was broken: the code was right and the state was wrong."
- **New bottleneck exposed:** Smoke tier growth/rot, handled by a weekly review; 2026-09-02 97786cf61 "issues: smoke --report lost 63 runs at the product rename".
- **Evidence:** Smoke log: 517 runs 2026-08-26 to 2026-10-09, 416 green, 101 red, median 58.6 s (python over `beebox-smoke-log.jsonl`). 10 issues have "smoke" in discovered-in (7 closed); 4 from the weekly smoke-review worktree.
- **Outcomes:** In use; required for code landings by finish.md ("Code changes require a passing smoke"). 101 red runs recorded (cause per run not classified here). Judgment: introduced in direct response to state escapes that tests could not see.
- **Prior-art mention:** no.

## Browser tours and tour-check schedule
- **One line:** Scripted Playwright-style walks (`test/tours/*.tour.ts`) that capture desktop and mobile screenshots, accessibility snapshots, and axe reports; a weekly agent session runs them, edits tours the app outgrew, and files the rest.
- **Lives in:** `beebox/test/tours/` (10 `.tour.` files: `git ls-files beebox | grep -c '\.tour\.'`), `beebox/docs/testing/tours.md`, `schedules/tour-check/`.
- **Appeared:** 2026-05-28 9a600875c "tours: scripted browser walks that produce review artifacts"; 2026-07-10 88bb0526c "tours: formalize — docs/tours.md, testing.md tier, silent-degradation fixes"; 2026-08-26 2c9d75eed "tours: repair the walks, fold dashboard into nav-pages, check them weekly".
- **Bottleneck relieved:** Ad hoc manual page checks. tours.md: "A tour is the app's walk, written down."
- **New bottleneck exposed:** Rot: tours.md says "three of five tours had been silently failing" before the weekly check; tour-check needed a 3h timeout (2026-10-08 16a6327cc).
- **Evidence:** 75 commits mention "tour" (`git log -i --grep='tour' --oneline | wc -l`); 9 issues with "tour" in discovered-in (6 closed); `bin/schedules list`: weekly, 2 open alerts.
- **Outcomes:** Running weekly. Example find: 2026-09-02 aaa69fe1d "issues: file the admin 'Available engines' run-on label found by the weekly tour check".
- **Prior-art mention:** no.

## `bin/browse` and the browse skill
- **One line:** Worktree-aware wrapper around a headless agent browser for inspecting the running dev app (navigate, accessibility tree, screenshots).
- **Lives in:** `bin/browse`, `browse/` package, `.claude/skills/browse/SKILL.md`.
- **Appeared:** 2026-05-26 74393cc71 "agent-browser: install + bin/browse wrapper for current worktree"; 2026-05-26 cf9693e81 "browse: add worktree-aware wrapper around agent-browser".
- **Bottleneck relieved:** Agents could not see frontend behavior. testing.md lists it as the loop for frontend bugs.
- **New bottleneck exposed:** Not visible.
- **Evidence:** 17 commits on bin/browse; skills-review: browse 51 Claude sessions, 9 Codex focused sessions over 60 days.
- **Outcomes:** In regular use (51 sessions/60 days); the smoke tier uses a browser walk (`bin/smoke-browse.ts`).
- **Prior-art mention:** skills-review yes (usage, 2 stale paths); others no.

## Scenario testing (`bbx scenario`) — retired
- **One line:** Scripted end-to-end runs of a whole box with stubbed fetch, later superseded by field tests.
- **Lives in (historical):** `src/scenario/` (deleted); successor `beebox/src/field-test/`, `beebox/field-tests/*/scenario.yaml`, `beebox/docs/testing/field-testing.md`.
- **Appeared:** 2026-02-21 69e0ed376 "Add scenario testing system for structured box testing"; 2026-02-21 c5c0e9ad4 "Strict fetch stubbing and time-gated stubs for scenarios"; removed 2026-09-16 741dca4cb "refactor: delete `bbx scenario` and its runner".
- **Bottleneck relieved:** No way to exercise a whole box end to end.
- **New bottleneck exposed:** It went unused; 741dca4cb: "No scenario files exist anywhere in the repo, so no invocation could succeed; the module's last change was the Bee Box rename while its successor, src/field-test/, kept receiving maintenance."
- **Evidence:** 502 lines removed (per 741dca4cb body). 19 issues have field-test in discovered-in.
- **Outcomes:** Abandoned 2026-09-16 (741dca4cb); the idea continues as field tests.
- **Prior-art mention:** meta-practices.html yes ("scenario testing — scripted end-to-end runs of a whole box", 2026-02-21; no retirement noted); skills-review one mention.

## Card validation hooks (warn on write, block on commit)
- **One line:** Per-box hooks: a PostToolUse hook runs `bbx validate --hook` after agent edits (warning fed back to the agent), and a box pre-commit runs `bbx validate --pre-commit` to block invalid cards; engine-spawned agents get the same via an in-process SDK hook.
- **Lives in:** `beebox/src/core/install-validation-hooks.ts`, `beebox/src/core/sdk-hooks.ts` (`cardValidatorHook`), `beebox/docs/cards/validation.md`.
- **Appeared:** 2026-05-23 06eea48c6 "Validation hooks: warn on write, block on commit". Precursor per meta-practices: "validation plugin in-repo" 2026-02-01.
- **Bottleneck relieved:** Agents writing malformed cards into boxes. Commit body: "on a card path with errors exit 2 with the error on stderr so the agent sees feedback".
- **New bottleneck exposed:** Commit-time cost of multiple CLI calls; validation.md: "That one invocation is the whole commit-time suite (it replaced three separate `bbx` calls ...see docs/plans/commit-performance.md)".
- **Evidence:** 7 commits on validation.md. testing.md instrument table: "blocks bad commits | automatic".
- **Outcomes:** In use in every box. Not quantified here (box-side, no repo ledger). Judgment: same pattern as the dev repo's PostToolUse lint hook, applied to box content.
- **Prior-art mention:** meta-practices.html yes ("enforcement, not advice"); others no.

## personal-vibe-check lint preset
- **One line:** A shared, versioned ESLint + Prettier + strict tsconfig + knip + oxlint + madge + husky/lint-staged preset with `vibe-init` and `vibe-check` CLIs and a custom rule plugin.
- **Lives in:** `personal-vibe-check/` (`preset.ts` 834 lines, `plugin.ts`, `rules/restrict-component-classes.ts`, `bin/vibe-check.ts`, `bin/vibe-init.ts`, `knip-base.json`, `tsconfig.base.json`, `conventions.md`, `CLAUDE.md`).
- **Appeared:** 2026-02-13 893ad26ff "Initial package setup"; integration 2026-02-14 0ba2a5969 / 27711c8a1 / 43872848c "Integrate personal-vibe-check: ESLint, knip, oxlint, husky" (one per pre-monorepo project); 2026-02-19 748ada62b "Add eslint-plugin-unicorn with 40 curated rules and Claude Code hook setup"; 2026-04-16 0117e96db "Add restrict-component-classes rule"; 2026-08-25 ab4738447 "convert the preset package to TypeScript".
- **Bottleneck relieved:** Per-project lint drift; README: "Bundles ESLint with 200+ reviewed rules, strict TypeScript config, and tooling for dead code detection and circular dependency checks."
- **New bottleneck exposed:** The integration turned rules off: b53159500 "The personal-vibe-check integration (1efb334c, 2026-02-14) turned off 18 rules ... silently disabling a chunk of our own documented style". (That cited sha is from pre-monorepo history and does not resolve here.) Led to the suppression ratchet.
- **Evidence:** 216 rule entries in preset.ts set to a severity (208 "error", 22 "off" by token count; `grep -oE '"[@a-z0-9/-]+":\s*\[?"(error|warn|off)"' preset.ts`, counts approximate since rules can repeat across config blocks). 153 commits with "lint" in subject (`git log --format=%s | grep -ic lint`).
- **Outcomes:** In use in beebox, bin, workstreams-app, site, clerk via pre-commit and the PostToolUse hook. Judgment: the strict baseline that the later guardrails (ratchet, no-disable rule) defend.
- **Prior-art mention:** meta-practices.html yes ("ESLint + knip + oxlint + husky as one shared, versioned preset", 2026-02-14); agent-knowledge.html one mention; skills-review no.

## PostToolUse lint hook (`vibe-check lint --hook`)
- **One line:** After every agent Edit/Write, ESLint runs on the file and failures are fed back to the agent (exit 2).
- **Lives in:** `.claude/settings.json` (PostToolUse `Edit|Write` → `beebox/node_modules/.bin/vibe-check lint --hook`), `personal-vibe-check/bin/vibe-check.ts`, `personal-vibe-check/hooks/lint-check.sh`.
- **Appeared:** 2026-02-17 0a77a4040 "Switch from Stop hook to PostToolUse lint hook"; 2026-02-17 cbd994b4f "Add vibe-check lint --hook command, remove shell script"; 2026-03-01 f777b0d49 "Add Prettier to pre-commit pipeline and make lint hook non-blocking".
- **Bottleneck relieved:** Lint errors discovered only at commit time, after many edits.
- **New bottleneck exposed:** Per-edit noise during coordinated multi-file edits; root CLAUDE.md now says "Finish coordinated edits before reacting to per-edit lint output".
- **Evidence:** Configured in `.claude/settings.json` today.
- **Outcomes:** Still active. Judgment: earliest agent-facing gate in the repo (Feb 2026).
- **Prior-art mention:** no (meta-practices covers the preset, not the hook specifically).

## ESLint suppression ratchet (retired) and the no-disable guardrail
- **One line:** Existing violations were recorded in `eslint-suppressions.json` so silenced rules could be re-enabled for new code and burned down; once at zero, the ratchet was removed and a standing rule forbids weakening lint rules without permission.
- **Lives in:** Root `CLAUDE.md` ("Do not disable or weaken lint rules ... The existing exception is one `eslint-disable-next-line <rule> -- <concrete justification>`"), `beebox/CLAUDE.md`, guard comments atop eslint configs; historical `eslint-suppressions.json` files (deleted).
- **Appeared:** 2026-05-30 61065cd84 "docs: audit of silently-disabled ESLint (personal-vibe-check) rules"; 2026-05-30 b53159500 "eslint: re-enable silenced rules via suppressions ratchet (<old-package> backend)"; 2026-05-31 7a3b28bb6 "establish suppressions ratchet" (cardworks); 2026-05-31 8965f1d36 "eslint: remove now-empty suppressions ratchet; harden the no-disable guardrail".
- **Bottleneck relieved:** Silently disabled rules. b53159500: "Capture existing debt in eslint-suppressions.json (1000 violations across 158 files) ... Rules are now ENFORCED for all new and touched code; existing debt is individually cataloged, not hidden."
- **New bottleneck exposed:** Agents disabling rules to pass; 8965f1d36: "Harden against silent re-disabling: add a prominent standing rule to the monorepo CLAUDE.md".
- **Evidence:** 1,000 suppressed violations at start (b53159500 body; 1,539-line suppressions file) reached zero by 2026-05-31 (8965f1d36: "All three projects are at zero suppressions"). 16 commits touched `*eslint-suppressions.json`. 19 eslint/burn-down commits between 2026-05-29 and 2026-06-01; 41 "burn down" subjects overall. Today: 190 `eslint-disable` comments in tracked TS, 172 in the justified `eslint-disable-next-line <rule> -- <reason>` form, 2 file-level (`git grep -c 'eslint-disable'`, `git grep -E 'eslint-disable-next-line [^ ]+ -- '`).
- **Outcomes:** Ratchet: 1,000 violations to 0 in about two days, then deleted (8965f1d36). Guardrail: still in root and beebox CLAUDE.md; 172 of 190 disables follow the justified form. Judgment: the ratchet was a temporary device; the lasting artifact is the rule text.
- **Prior-art mention:** meta-practices.html yes (ratchet "count disabled rules; the number may only go down" — the commits show it counted individual violations, not rules; guardrail "block weakening a lint rule just to make code pass"); others no.

## Lint economics: `lint:changed`, eslint cache, `with-slot` semaphore
- **One line:** Lint only the files/packages the change implicates, with eslint `--cache` and `tsc --incremental`; whole-tree lint/typecheck runs take a test-semaphore slot.
- **Lives in:** `bin/lint-changed.ts`, `bin/with-slot.ts`, `package.json` / `beebox/package.json` (`lint:changed`, `--cache` flags), `beebox/CLAUDE.md`.
- **Appeared:** 2026-08-25 6e565471b "perf(tooling): lint what the change implicates, cache what it doesn't"; 2026-08-25 fe4a55696 "fix(tooling): close three gaps a cross-model review found in the lint economics".
- **Bottleneck relieved:** Contention: 6e565471b "six concurrent eslint runs took 29-51 minutes each"; "Warm runs go 32-43s to 4.4s and 8-12s to 2.8s". Issue `issues/closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md`.
- **New bottleneck exposed:** Stated accepted escape: "a change in file A can break lint in file B that imports it ... missed here".
- **Evidence:** 6 commits on bin/lint-changed.ts; timings from the commit body.
- **Outcomes:** In use (documented iteration command). Judgment: the lint counterpart of test selection, landed the same day.
- **Prior-art mention:** no.

## lint-script-coverage test
- **One line:** A node test asserting the root `lint` script still includes `lint:bin` and that the workspace fan-out excludes only the frontend that beebox's lint covers.
- **Lives in:** `bin/lint-script-coverage.test.ts`.
- **Appeared:** 2026-08-13 3a561ddbe "Speed up finish lint and typecheck gates". 7 commits.
- **Bottleneck relieved:** Silent loss of lint coverage when scripts are edited; comment: "Dropping it would silently un-lint bin/ again." Related: `issues/code-quality/2026-08-26-bin-typescript-is-not-linted.md` (cited in `.husky/pre-commit`).
- **New bottleneck exposed:** Not visible.
- **Evidence:** 7 commits.
- **Outcomes:** Active test. Judgment: a test over the configuration of the gates.
- **Prior-art mention:** no.

## Supplemental lint schedule (oxlint + madge circular)
- **One line:** Weekly baseline-diff of oxlint and circular-dependency findings; reports only new ones and may land its own green fixes.
- **Lives in:** `schedules/supplemental-lint/`, `beebox/package.json` (`lint:oxlint`, `lint:circular`).
- **Appeared:** 2026-08-29 ccdfe5c98 "Schedule supplemental lint sweeps" (Issue `2026-08-25-oxlint-circular-no-cadence`); 2026-09-12 167b95107 "let the lint sweep land its own green fixes"; 2026-09-12 e4fd6bb0e "stop madge's numbering from faking new findings"; 2026-10-03 bc791b801 "key oxlint findings by rule and flagged line".
- **Bottleneck relieved:** oxlint/madge in the preset had no cadence (issue title "oxlint and the circular-dep check still have no cadence").
- **New bottleneck exposed:** False "new" findings from unstable madge numbering (e4fd6bb0e).
- **Evidence:** 9 commits on the dir; 25 commits mention supplemental-lint; 2026-10-06 2cc04dbdf "Clear the 21 standing oxlint warnings". `bin/schedules list`: weekly, last 126h ago (handoff).
- **Outcomes:** Running; cleared 21 standing oxlint warnings (2cc04dbdf). Only 1 issue lists it in discovered-in.
- **Prior-art mention:** skills-review one mention; meta-practices (oxlint under preset only).

## Knip dead-code sweep (`schedules/knip-sweep`)
- **One line:** Weekly knip run with a baseline diff, reporting new dead exports/files; lands its own green sweeps.
- **Lives in:** `schedules/knip-sweep/`, root `package.json` `lint:knip`, `personal-vibe-check/knip-base.json`.
- **Appeared:** knip in preset 2026-02-13 893ad26ff; schedule 2026-08-24 56fae9331 "schedules: enroll knip-sweep (Track F)"; 2026-09-12 707a8c8fc "knip-sweep lands its own green sweeps".
- **Bottleneck relieved:** Dead-code backlog. 2026-08-24 056d74686 "Burn down the backend unused-export backlog: 342 -> 4".
- **New bottleneck exposed:** Flakes blocking its landing: 2026-10-07 ce7d7ca45 "Issue: note that the session-retention flake blocks knip-sweep landing"; 7b1a72906 "File session-retention 64 MB heap-cap flake found by knip-sweep".
- **Evidence:** 97 commits mention knip; 35 mention knip-sweep; 8 issues have knip in discovered-in (4 closed); `bin/schedules list`: 2 open alerts.
- **Outcomes:** Running; b5073f475 "knip-sweep: drop 42 file-local exports, delete dead recoverTrashReceipt"; backlog 342 to 4 before scheduling.
- **Prior-art mention:** meta-practices (in the preset line); skills-review one mention.

## Layout check (`pnpm layout-check`)
- **One line:** Scanner enforcing the source file-layout rules at zero findings for every package root; runs in pre-commit on code, doctest, or package.json changes, including deletions.
- **Lives in:** `beebox/src/dev/layout/check/`, `beebox/package.json` `layout-check`, `.husky/pre-commit`, `beebox/docs/implemented-plans/file-layout*.md`.
- **Appeared:** 2026-09-27 228b71fb2 "Layout check: scanner, rules, and CLI (pnpm layout-check)"; 2026-09-27 0ffe31e0d "Layout check: apply cross-model review". Origin issue `issues/closed/code-quality/2026-09-26-source-file-layout-review-and-enforcement.md`.
- **Bottleneck relieved:** File placement drift. Hook comment: "every package root must stay at zero findings ... a change in one directory can create a finding in another".
- **New bottleneck exposed:** Path moves broke runtime paths (1985a36d0 "Layout moves: fix runtime path computations broken by scripts/ and user-stories/ fold"; 881eb9dab "Rewrite pre-move path mentions").
- **Evidence:** 43 commits mention layout check/moves (`git log -i --grep='layout check\|layout-check\|layout moves' --oneline | wc -l`).
- **Outcomes:** Active in pre-commit. Judgment: recent (12 days old), no recorded catches yet.
- **Prior-art mention:** no.

## Doc-check (`pnpm doc-check`)
- **One line:** Fails commits touching Markdown on broken references, orphaned live docs, or duplicate issue basenames; `--fix` repairs links whose basename is unique.
- **Lives in:** `beebox/src/dev/doc-check/`, `.husky/pre-commit` ("Any commit touching markdown runs the fast doc reference/orphan check"), `beebox/docs/README.md`.
- **Appeared:** 2026-07-04 efad24c61 "feat(docs): doc-check enforcement — broken refs + live-area orphans fail commits"; 2026-10-07 6657f44d1 "Skill mechanics move to scripts; doc-check validates backticked paths".
- **Bottleneck relieved:** Link rot as files moved; also enabled hooks on docs commits: efad24c61 "CLAUDE.md policy updated: don't --no-verify docs commits anymore".
- **New bottleneck exposed:** Not visible.
- **Evidence:** 4 commits on check.ts.
- **Outcomes:** Active on every Markdown commit. Not quantified (no ledger of blocked commits).
- **Prior-art mention:** no.

## Path-leak check and personal commit blocklist
- **One line:** Two pre-commit guards on every commit: block tracked files containing a personal home path; block staged additions matching a gitignored per-developer blocklist (fail closed if malformed).
- **Lives in:** `bin/path-leak-check.ts`, `bin/commit-blocklist-check.ts`, `.commit-blocklist.example`, `.husky/pre-commit`.
- **Appeared:** 2026-07-05 6a4fa15a0 "Add home-directory leak guard for source-available release"; 2026-07-05 f6344efb3 "feat(bin): personal commit-blocklist pre-commit guard".
- **Bottleneck relieved:** Leaks ahead of going source-available. path-leak-check header: "agents paste whatever the ambient environment hands them — the Read tool requires absolute paths ... so an 'Evidence: <file>' citation carries the full ... prefix."
- **New bottleneck exposed:** Not visible.
- **Evidence:** 6 and 7 commits respectively.
- **Outcomes:** Active on every commit. Not quantified.
- **Prior-art mention:** no.

## Retired-product-name check
- **One line:** Pre-commit block on the old product name outside an allowlist.
- **Lives in:** `bin/retired-product-name-check.ts`, `.husky/pre-commit`.
- **Appeared:** 2026-08-30 dab834811 "feat!: rename the former product name to Bee Box". 1 commit.
- **Bottleneck relieved / exposed:** Rename regressions / not visible.
- **Evidence:** 1 commit.
- **Outcomes:** Active. Not quantified.
- **Prior-art mention:** no.

## Staged security pre-commit (`bin/precommit-security.ts`)
- **One line:** Offline pre-commit checks over staged content: private keys, unresolved merge markers, shellcheck on staged hook/bin shell files.
- **Lives in:** `bin/precommit-security.ts`, `.husky/pre-commit`, root `package.json` (shellcheck dep).
- **Appeared:** 2026-08-29 6deee0f14 "Add staged security pre-commit checks"; 2026-09-13 ea23235da "fix(bin): stop the security hook crashing on a large staged file".
- **Bottleneck relieved:** Not stated beyond the hook comment.
- **New bottleneck exposed:** Crash on large staged files (ea23235da; MAX_BUFFER comment).
- **Evidence:** 3 commits.
- **Outcomes:** Active. Not quantified.
- **Prior-art mention:** no.

## Security report skill
- **One line:** A committed rubric (skill) from which an agent regenerates a structured security report and a derived overview after security-relevant changes.
- **Lives in:** `.claude/skills/security-report/SKILL.md` (277 lines), `beebox/docs/security-report.md` (630 lines, 8 sections), `beebox/docs/security-overview.md`, `SECURITY.md`.
- **Appeared:** 2026-08-07 db7901c5e "feat(security): agent-maintained security report system + DRAFT launch SECURITY.md". Issue `issues/closed/features/2026-07-20-agent-maintained-security-report.md`.
- **Bottleneck relieved:** One-time audits going stale; issue: "a document an agent maintains, not a one-time audit."
- **New bottleneck exposed:** Not visible.
- **Evidence:** 18 commits on the skill; 43 on security-report.md; 32 commits mention it; 18 issues with "security" in discovered-in (9 closed); skills-review: 5 Claude sessions, 2 Codex focused over 60 days.
- **Outcomes:** In use; the closing note says a second regeneration cycle ran (a8aa45fd) and review findings were applied (3589d96c, 3bbddcc5). Related: schedules/cross-box-leak-scan (2026-09-04 188f3c493).
- **Prior-art mention:** skills-review yes ("keep (~240); script the surface-map existence check"); others no.

## Mobile-contract tripwire and `Contract-Unchanged:` trailer
- **One line:** Pre-commit records when a contract-surface anchor file is staged without a `beebox/docs/mobile-contract.md` update; commit-msg blocks unless the message carries `Contract-Unchanged: <reason>`. Shared golden fixtures run in both TS and iOS suites.
- **Lives in:** `bin/mobile-contract-check.ts`, `.husky/pre-commit`, `.husky/commit-msg`, `beebox/docs/mobile-contract.md` §11 anchors, `test/mobile-contract/fixtures/`, `.claude/skills/bbx-ios-overlap`.
- **Appeared:** 2026-07-17 e577200a7 "Add shared mobile-contract fixtures and the contract tripwire"; contract doc 2026-07-17 cae733c69.
- **Bottleneck relieved:** Web/iOS drift; e577200a7: "Editing a vector once fails every platform that implements it." (59 fixture cases at birth.)
- **New bottleneck exposed:** Override volume (see evidence).
- **Evidence:** 101 commits carry `Contract-Unchanged:` (`git log --grep='Contract-Unchanged:' --oneline | wc -l`); 43 commits on mobile-contract.md; 11 issues discovered in a 2026-07-17 iOS companion review.
- **Outcomes:** Active. Judgment: the 101 overrides vs 43 contract-doc edits suggest most trips are declared non-changes; whether any caught real drift is not recorded in commit messages.
- **Prior-art mention:** skills-review one mention; others no.

## Scan-upload contract version
- **One line:** A hand-bumped `SCAN_CONTRACT_VERSION` constant mirrored in the stand-alone uploader and beebox's scan routes.
- **Lives in:** `scan-uploader/src/cli/contract-version.ts`, `beebox/src/core/scan/contract-version.ts`, `beebox/docs/scan-upload-contract.md`.
- **Appeared:** contract doc 2026-08-01 79c40f198; version constant first mentioned 2026-09-14 5472199c9 "docs(plans): draft annex-at-init and scan-uploader version drift".
- **Bottleneck relieved:** Copied-single-file client drifting from the server.
- **New bottleneck exposed:** Not visible.
- **Evidence:** Value is 1 in both files; 2 commits changed the assignment line.
- **Outcomes:** Never bumped. Judgment: too early to show effect.
- **Prior-art mention:** no.

## Clerk contract staleness gate
- **One line:** Pre-commit regenerates the clerk extension's generated contract snapshot when its schema, generator, snapshot, or the hook changes, and fails if it differs.
- **Lives in:** `bin/snapshot-clerk-contract.ts`, `.husky/pre-commit`.
- **Appeared:** 2026-07-12 27720149d "feat(clerk): generated-and-CI-checked clerk↔server contract (Track 1)". 5 commits.
- **Bottleneck relieved:** Per-package hooks never exercised the other side of the clerk wire shape (hook comment).
- **Outcomes / Evidence:** Active; not quantified.
- **Prior-art mention:** no.

## Cross-model review
- **One line:** Plans and diffs beyond a small fix are reviewed by the other model family (Claude work by Codex, Codex work by Claude), and findings are adjudicated.
- **Lives in:** `.claude/skills/cross-model/SKILL.md` (150 lines), `bin/cross-model-run.ts` (269 lines) + `bin/cross-model-run`, root `CLAUDE.md` ("The reviewer must use the other model family, regardless of the driving model").
- **Appeared:** 2026-06-04 b3bf67809 "skill(codex): callback-native cross-model review skill + docs/plans convention notes"; 2026-08-04 aae37764a "feat(skills): make the cross-model review skill bidirectional" (first commit with "other model family"); 2026-08-15 36780b7f3 "reporting never editorializes about the review's worth"; 2026-10-07 6657f44d1 "Skill mechanics move to scripts" (runner moved to bin).
- **Bottleneck relieved:** Same-model blind spots. workstream-story.md: "A model can't catch the blind spots it shares with itself."
- **New bottleneck exposed:** Skill size and invocation mechanics (skills-review: "shrink to ~130; runner prose becomes a script"); enforcement is guidance only (skills-review: "a hook that checks for a review marker before `bin/land` would enforce it").
- **Evidence:** 216 commits mention "cross-model" (`git log --grep='cross-model' --oneline | wc -l`); by month 2026-06 10, 07 26, 08 110, 09 50, 10 20. 385 with broader `-i --grep='cross-model\|cross model\|codex review'`. 40 commits state a review found/caught defects (`git log -i -E --grep='(cross-model|adversarial|codex|claude) review (found|caught)|found by cross-model|(defects?|gaps?|holes?|bugs?) (a|the) (cross-model|adversarial|codex)'`): 2026-07 6, 08 23, 09 11. 55 issues with cross-model/codex/adversarial in discovered-in (41 closed). Skills-review: 140 Claude sessions invoked it, 32 Codex focused sessions, over 60 days (2026-08-08 to 2026-10-07).
- **Outcomes:** In use on most non-trivial work. Recorded catches include: ea2358b2a "eight defects from the Codex review of the branch" (test economics); 92c74000e "close the two false greens a cross-model review found in the smoke tier"; fe4a55696 "close three gaps ... in the lint economics"; 585a8bf1e, 4bf0178f8, 7f3ac3271 (four, four, three defects in add-box, admin backup, deploy); d1556e750 "close the send-path holes an adversarial review found"; e4b8e5547 "full-suite: verdict-state fixes from cross-model review". The test-selection plan records that two reviews flipped its mechanism. Judgment: the quality technique with the most recorded catches in commit messages; it also reviewed most of the other gates in this sweep.
- **Prior-art mention:** workstream-story.md yes (loop diagram; "anything bigger than a small fix gets reviewed by the other model family"); meta-practices.html yes ("codex cross-model review", 2026-06-04); skills-review yes (usage numbers, shrink recommendation, enforcement hook idea); agent-knowledge.html no.

## Husky hook set (`.husky/`)
- **One line:** One root hook set shared by all worktrees via `core.hooksPath`, dispatching per-subproject checks by staged paths.
- **Lives in:** `.husky/pre-commit`, `commit-msg`, `prepare-commit-msg`, `post-commit`, `post-merge`, `post-checkout`, `pre-push`.
- **What each runs:**
  - `pre-commit`: retired-product-name-check; `bin/precommit-security.ts`; `path-leak-check`; `commit-blocklist-check`; `mobile-contract-check` (record only); `bin/doc-lifecycle-check.ts --index`; `bin/schedules lint` if schedules/ staged; `bin/skill-lint.ts --quiet` if .claude/ staged; `doc-check` if .md staged; `layout-check` if code/doctest/package.json staged (incl. deletions); docs-only exit; clerk contract staleness gate; beebox and beebox-clerk lint-staged ∥ typecheck (run in parallel, `--no-stash`); site lint+typecheck; workstreams-app lint+typecheck; cross-package typecheck of workstreams-app and root when `beebox/src/` staged; `lint:bin` for bin/; `dev-apps-typecheck` for `dev/apps/*.ts(x)`.
  - `commit-msg`: mobile-contract block unless `Contract-Unchanged:`; `commit-provenance --check` (an `Issue:` trailer must name an existing issue).
  - `prepare-commit-msg`: stamps `Workstream:`/`Plan:` trailers; never blocks.
  - `post-commit` / `post-merge`: auto-deploy from main only when a shipped path changed; CLI bundle rebuild; post-merge dependency install; unpushed-main warning; git-lfs.
  - `post-checkout`, `pre-push`: git-lfs.
- **Appeared:** 2026-05-26 085a23011 "Hoist husky to monorepo root; recover hooks broken by migration" (pre-commit comment: "After the monorepo migration each subproject lost its own .git, so those individual husky setups silently stopped working."). Later additions are dated in their own entries.
- **Bottleneck relieved:** Hooks silently lost at the monorepo merge; per-subproject gating.
- **New bottleneck exposed:** Cross-package breakage escaping per-package gates: pre-commit comment on 2026-09-06 "the OpenRouter landing renamed `createOpenAIEmbeddingsService`, and `bin/issues` plus the hourly deferred-issues schedule were down"; lint-staged's stash clobbering concurrent agents' edits (hence `--no-stash`); commit latency (parallel run_pair: "takes a warm code commit from ~7s to ~5s").
- **Evidence:** 7 hook files; `.husky/pre-commit` 220 lines.
- **Outcomes:** All active. Judgment: the pre-commit hook is where most gates in this sweep were attached; its comments record each escape that added a branch.
- **Prior-art mention:** meta-practices (in the preset line); skills-review one mention ("Lands beside the existing husky hooks").

## Schedule lint, skill lint, document-lifecycle check
- **One line:** Three pre-commit linters over agent-process files: `bin/schedules lint` (schedule definitions), `bin/skill-lint.ts` (skill/subagent frontmatter, size, sigils, backticked paths), `bin/doc-lifecycle-check.ts` (plan status vs directory).
- **Lives in:** `bin/lib/schedules-lint.ts`, `bin/skill-lint.ts`, `bin/doc-lifecycle-check.ts`, `.husky/pre-commit`.
- **Appeared:** 2026-08-24 703f3a8bb "schedules: bin/schedules lint, and a tick that alerts about a broken schedule (Track E)"; 2026-09-13 12d776dd2 "Clarify document lifecycle and validate plans before landing"; 2026-10-07 6657f44d1 (skill-lint).
- **Bottleneck relieved:** Hook comment: "A schedule that fails lint is a schedule that fails at 03:00 on a Sunday with nobody watching".
- **Evidence:** 6, 2, 2 commits respectively.
- **Outcomes:** Active; skill-lint 2 days old. Not quantified.
- **Prior-art mention:** no.

## Commit-provenance `Issue:` trailer check
- **One line:** commit-msg refuses an `Issue:` trailer that names no existing issue file.
- **Lives in:** `bin/commit-provenance.ts`, `.husky/commit-msg`.
- **Appeared:** 2026-08-24 e00c5dcca "feat(bin): commit provenance trailers (Workstream/Plan/Issue)". 8 commits.
- **Bottleneck relieved:** Hook comment: "a misspelled name is a permanent dangling link, since commits are immutable".
- **Outcomes:** Active. Not quantified. (Other sweeps may cover provenance trailers as process, not gate.)
- **Prior-art mention:** no.

## dev-apps typecheck
- **One line:** Staged TS under `dev/apps/` gets a tsc build check with the exhibits container's settings.
- **Lives in:** `bin/dev-apps-typecheck`, root `package.json`, `.husky/pre-commit`.
- **Appeared:** 2026-08-17 437063041 "feat(exhibits): this-will-build gate for committed apps". 2 commits.
- **Bottleneck relieved:** Hook comment: exhibit apps are "deliberately outside every package's lint — casual by design — but they merge to main and live forever".
- **Outcomes:** Active. Not quantified.
- **Prior-art mention:** no.

## "Treat unsolicited tool output as a bug"
- **One line:** Warnings, deprecations, ignored-build-script lists and peer-dependency mismatches are fixed at the source; routine success output goes behind debug.
- **Lives in:** Root `CLAUDE.md` ("Treat unsolicited tool output ... as a bug"), `beebox/CLAUDE.md` ("Warnings, deprecations, and other unsolicited noise are actionable").
- **Appeared:** 2026-05-26 085a23011 added "**Treat noisy command output as a bug.** ... cost real agent context every time they appear"; same day 91973749e "Silence install warnings across all packages"; reworded 2026-09-12 c8c728285 / 6fa206288.
- **Bottleneck relieved:** Agent context spent on noise (the 2026-05-26 wording).
- **New bottleneck exposed:** Not visible; related: tap output made agent-first 2026-06-09 3aecb4c05.
- **Evidence:** 306 commits mention silence/noise/warning (`git log -i --grep='silence\|noise\|warning' --oneline | wc -l`; loose proxy).
- **Outcomes:** Still in root guidance. Judgment: shaped many gates' "silent on success" design (doc-check, schedules lint, path-leak).
- **Prior-art mention:** agent-knowledge.html mentions "noisy" twice in another sense (prose counts); otherwise no.

---

## Summary
- Layer order visible in git: PostToolUse lint hook and vibe-check preset (Feb), doctests (Mar), monorepo hook recovery and noise rule (May 26), suppression ratchet then no-disable rule (May 30-31), cross-model review (Jun 4; bidirectional Aug 4), contract tripwires and doc-check (Jul), test ledger (Aug 9), then on Aug 24-26 selection, careful tier, finish scripts, hourly full suite, smoke tier, lint economics, knip and supplemental sweeps, weekly tour check; layout check (Sep 27).
- Recorded catches: cross-model review has 40 commits stating review-found defects and 55 issues; full-suite has 29 red issues (11 fixed, 16 duplicates/superseded); smoke 517 runs (101 red); test ledger 1,915 runs, 717 files ever failed; flake list of 49 files still open.
- Retired: `bbx scenario` (741dca4cb, 2026-09-16); the eslint suppressions ratchet (8965f1d36, 2026-05-31, after reaching zero).

## Could not verify
- Full-suite run counts come from an issue's text; the schedule run logs live outside the repo (`~/src/schedule-runs/`) and were not read. Ledger "full" counts include bisect and non-schedule runs.
- No record of how many commits each pre-commit gate blocked (doc-check, path-leak, layout, security); those outcomes are unquantified.
- Cross-model invocation counts are from `dev/skills-review-2026-10.md`, not re-counted from transcripts.
- The 1efb334c sha cited in b53159500 does not resolve here (pre-monorepo history); the 02-14 integration commits are 0ba2a5969 / 27711c8a1 / 43872848c.
- Rule count in preset.ts is a token count of severity entries, not a resolved-config count.
- Why the 101 smoke reds failed was not classified.
