# Test churn over git history: signal vs cost

Repo: the test-value-research worktree, HEAD 7508d99a2, 10,086 commits (2026-01-27 to 2026-10-22), 1,332 `*.test.ts` files.
Scripts: `churn.py` (per-file CSV), `sample_expected.py` (step 2), `sample_fix.py` (step 3), `ratios.py` (denominators) in `scripts/`. They take the repo and ledger paths from the `REPO`, `LEDGER`, `FILESETS` and `SCRATCH` environment variables.
Data: `data/churn.csv` (one row per test), `data/mechanical.json` (the excluded commits), `data/sample_expected_hashes.json` and `data/sample_fix_hashes.json` (the sampled commits).

## Method

Per test file: `git log --no-merges --follow --name-status`. Git's rename detection does not bridge the 2026-10-18 doctest conversion (the `.doctest.md` was deleted and a `.test.ts` added with different content), so when a file's first commit is one of the track-4 "Convert ... doctests" commits and `<base>.doctest.md` exists in that commit's parent, the script continues the log from the doctest path. 1,074 of 1,332 files (80.6%) were bridged this way; the rest were born as `.test.ts` (clerk, bin, canvas-loop, and everything after 10-18).

Mechanical commits (85, listed in `mechanical.json`): any commit touching >50 test files, plus commits whose subject matches the sweep families: `Test cleanup*` (2026-10-08), `Typecheck doctests*` (10-16), `Strengthen test checks*` and `Convert ... doctests`/`Drop doctest leftovers`/`Purge the word "doctest"`/`Rename agent-doctest`/`Remove the doctest format` (10-18), `Layout moves*` and `Rewrite pre-move path mentions` (09-27), the CLAUDE.md to AGENTS.md renames (10-09, 5d476d983 and d6d046edb), `test(doctest): declare|group` (06-21), `One-root consumer sweep` (09-04), the 2026-08-30 product rename. The "Strengthen test checks" family is counted mechanical although it edited assertions (tightening `includes` to full values across ~500 files in one pass); that is a judgment call, noted below.

"Non-test source" = a file with a code extension (`.ts .tsx .js .mjs .cjs .jsx .css .html .sh .py .swift .yaml .yml .toml .json`) that is not a test and not under a `test/`, `tests/`, `fixtures/`, `golden/` directory. Test helpers therefore do not count as source.

"Subject module" = a source file whose basename before the first dot equals the test file's basename before the first dot (`card-lint.test.ts` matches `src/core/card-lint.ts`).

Age is measured to 2026-10-22.

## 1. Per-test distributions (n = 1,332)

| measure | count | share |
|---|---|---|
| never changed since creation, excluding mechanical commits | 328 | 24.6% |
| never changed at all, mechanical included | 46 | 3.5% |
| created in a mechanical commit | 18 | 1.4% |
| creation commit also touched non-test source ("co-created with code") | 1,312 | 98.5% |
| creation commit touched a same-basename source file | 938 | 70.4% |
| creation commit message mentions fix/bug/regression (loose regex) | 363 | 27.3% |
| ≥1 later non-mechanical commit that also touched source | 986 | 74.0% |
| ≥1 later commit that touched the same-basename source file | 702 | 52.7% |
| ≥1 later small (≤6 files) code-and-test commit | 442 | 33.2% |
| ≥1 later test-only commit | 174 | 13.1% |
| later edits are test-only and nothing else (≥1 test-only, 0 code-and-test) | 18 | 1.4% |
| ≥3 test-only edits | 16 | 1.2% |

Per-file counts: later non-mechanical commits mean 2.94, median 2, max 45 (`beebox/test/core/card-lint.test.ts`, 44 of them with source). Later code-and-test mean 2.75, median 2. Later test-only mean 0.19, median 0. Later mechanical commits mean 5.97, median 6, max 15: the average test file has been rewritten by sweeps three times as often as by test-only edits.

Histogram of later non-mechanical commits per test: 0: 328, 1: 279, 2: 219, 3: 147, 4: 78, 5: 68, 6: 47, 7: 41, 8: 32, 9: 19, 10+: 74.

Creation commit size: median 12 files, 8 source files, 2.5 test files; 25.5% of tests were created in a commit of ≤6 files. The 98.5% "co-created" figure is therefore mostly a statement that commits here are feature-sized, not that each test was paired with one source change. The 70.4% same-basename figure is the tighter one.

By age (never-changed excludes mechanical; "code+test" = ≥1 later commit that touched source):

| age | n | never changed | code+test ≥1 | co-created |
|---|---|---|---|---|
| 0-30 d | 364 | 37% | 61% | 99% |
| 30-90 d | 613 | 24% | 74% | 99% |
| 90-180 d | 312 | 14% | 86% | 98% |
| 180-400 d | 43 | 7% | 93% | 93% |

By package: beebox/test 22% never changed (192/862), beebox/src frontend tests 27% (61/224), workstreams-app 30%, bin/test 40%, beebox-clerk 53% (9/17), scan-uploader 43%.

Creation month: Mar 35, Apr 13, May 29, Jun 83, Jul 244, Aug 335, Sep 339, Oct 254. Lines per test: mean 170, median 122, max 883.

Reading. Three quarters of tests have been edited alongside a source change at least once after creation, and the share climbs with age, so most tests have tracked at least one behavior change. The test-only edit rate is low (13% of files, 1.2% with three or more): tests that need maintenance without a code change are rare. The dominant cost is the sweeps: six mechanical rewrites per file on average, almost all in three days (09-27, 10-08, 10-18).

The "regression pin at creation" share (27%) is a loose upper bound: the regex also matches "Review fixes" and "prefix". Section 3 measures it properly on a sample.

## 2. Expected-value edits: 40 sampled commits

Population: 2,022 non-mechanical commits modify an existing test file. In a random 200 of those, 92 (46%) contain a hunk that both removes and adds lines near a `t.check(`/`t.equal(`/`=>` assertion, so roughly 930 commits in history edited an expected value. 40 were sampled (seed 7) and classified by reading the diff and message (`sample_expected.txt`).

| class | n | share |
|---|---|---|
| (a) intended behavior change, test updated to the new contract | 23 | 58% |
| (b) bug fix, the old expected value encoded the wrong behavior | 6 | 15% |
| (c) refactor churn: format/name/signature changed, same behavior | 6 | 15% |
| (d) test tightened/loosened/hardened with no product change | 5 | 12% |
| (e) other | 0 | 0% |

(a) examples:
- 00be3d5de `workstreams-app/test/workstream-launching-ui.doctest.md`: `"dormant":["resume"]` to `"dormant":["resume","archive"]` when Archive buttons were added.
- 3597a62e6 `beebox/src/frontend/test/components/todo/summary.doctest.md`: `[0 on your plate] · 1 later` to `0 on your plate · [1 later]` (the control moves to the count it goes to).
- 9504c10c0 `beebox/test/core/provider-env/openrouter-chat.doctest.md`: `loadSmallModel => null` to `=> moonshotai/kimi-k2-0905:exacto` (small slot now follows the OpenRouter box default).
- fd0aa5254 `beebox/test/core/capture/prepare.doctest.md`: `{% image ref=... /%}` to `[photo-001](attach/photo-001.image.card)` (core tags retired).

(b) examples (the old value was the bug):
- 96cb88579 `(pre-rename package)/test/core/bulk-upload/sweep.doctest.md`: `"session":"s-x"` to `"session":"s-target"`. The sweep notified the wrong chat; the test had pinned the wrong target. The same commit adds the once-ever guard check.
- 7ad114960 `(pre-rename package)/test/frontend/emission-assemble.doctest.md`: message now ends `with the doc [file1] [file2]`; before, `<attachments>` listed files the body never referenced.
- 511beb2db `beebox/test/services/codex-rollout-model.test.ts`: `t.check(codexHomeDir(undefined), process.env.CODEX_HOME)` to `t.check(codexHomeDir({ PATH: "/bin" }), join(homedir(), ".codex"))` (found by cross-model review).
- 263a52a9a `beebox/test/services/codex-cli.doctest.md`: `"kind":"incompatible"` to `"kind":"inconclusive"`.
- 86a2b0c17 `beebox/src/frontend/test/lib/off-machine-origin.test.ts`: adds `http://[::ffff:7f00:1:1]/` as `true` (mapped-loopback check matched too much).
- 33694b9e2 `bin/test-graph.test.ts`: the test asserted only `universe`, which "is exactly why it passed"; now asserts `depsOf(...)`.

(c) examples (cost without signal):
- 6d0ec43f7 `beebox/test/cli/commands/view/command.test-command.test.ts`: a one-line fix replacing `text-warm-800` with `text-card-ink` inside a full-HTML `str` snapshot, in a separate commit after 243d903db broke it.
- 40d79f608 (15 files): fixture people renamed to Rosa Okafor and Walter for the commit blocklist.
- 42ae69a52 `(pre-rename package)/test/result.doctest.md`: `ok(undefined)` to `okVoid`.
- 9c3dd3e8b `beebox/test/core/commands/pdf-extract.doctest.md`: `makeTmpBox({ git: true, annex: true })` to `makeTmpBox({ git: true })` across 20 files (fixture API change).
- 0c0877d70 `beebox/test/core/event-bus.doctest.md`: `isRecord(rows[1]?.data) ? ...` to `rows[1]?.event === "unknown" ? ...` (type union refactor, same expected output).
- 1cb1d347e `beebox/src/frontend/test/hooks/useFragmentJump.test.ts`: `render(path)` gains a `body` argument in three tests.

(d) examples:
- 4514e75c1 `beebox/test/core/scan/promote-debounce.doctest.md`: real sleeps replaced by a mocked clock, and the checkpoint moved from 230 ms to 350 ms so that "a mutant that keeps the first timer" fails (it passed 8/8 before).
- eded70866 and 21d12d818 `file-watcher` tests: `waitForWatch`, labelled `waitFor`, then a rewrite-until-delivered `eventually` loop for dropped FSEvents.
- 96e5b2944 `bin/test/finish-verify.doctest.md`: a 200 ms sleep replaced by `eventually(() => !alive(grandchild))`.
- a63151636 `beebox/test/core/pdf/extract.integration.doctest.md`: skip logic for a missing Hugging Face cache.

Reading. About three quarters of expected-value edits carry meaning (a+b = 73%); of those, one in five is the test catching that its own pinned value was wrong (b). The (c) churn is concentrated in snapshot-style assertions (full HTML strings, whole-list outputs such as the plugin list in 8bb68497b, fixture API signatures). The (d) edits are flake hardening on the few tests that use real timers or the real filesystem watcher, and one deliberate mutant-killing tightening.

Several (a) commits are also bug fixes whose fix required a contract change (760d14e5c `installRootLandmark` now returns the path instead of `true`; d253bd902 bootstrap returns a discriminated outcome; f5b54c8b7 sleep-affected runs now count). They are classified (a) because the edited value is the new contract, and each adds a separate regression check.

## 3. Fix commits: do they add a replay of the bug?

Denominators (non-mechanical commits, source = non-test code):

| population | n | src+test | src only | test only |
|---|---|---|---|---|
| message contains fix/fixes/fixed/regression/bug (word-bounded) | 2,230 | 844 (38%) | 717 (32%) | 78 (3%) |
| subject starts `fix(`/`fix:`/`Fix ` | 1,010 | 469 (46%) | 446 (44%) | 43 (4%) |
| all non-mechanical commits | 7,939 | 2,410 (30%) | 2,230 (28%) | 219 (3%) |

So a conventional `fix:` commit touches a test about as often as not. The 446 test-less fix commits split by area: frontend/UI 173, backend 167, dev tooling 45, iOS 21 (iOS has its own XCTest files, not counted here), mixed 40. Sampled subjects: `fix(chat): detect mic-side death mid-recording` (VoiceRecorder.tsx), `fix(frontend): resync card/list views on WebSocket reconnect`, `fix(ssr): guard module-level browser globals`, `fix(backend): resolve no-floating-promises fallout (Track F)`, `fix(lint): move empty flat config`. Many are UI/lifecycle code without a unit seam, or lint fallout.

Sample: 30 random commits (seed 11) from the 988 commits matching the unbounded `fix|regression|bug` grep that touch src and test together (`sample_fix.txt`).

| outcome | n |
|---|---|
| genuine bug fix, added test names the symptom or issue (replay) | 22 |
| genuine bug fix, test changed but no symptom replay | 2 |
| not a bug fix (grep matched "prefix", "fixtures", "fixed props", or a feature) | 6 |

Replay examples:
- e3e06583d: "A fresh CLAUDE.md gets its AGENTS.md mirror"; message states "Both halves fail with the fix reverted"; closes the issue file.
- 5252c36c2 `bin/`: "ensureStoreRoot claims an empty unmarked directory but refuses one with contents" (the launchd tick had exited 1 for a day).
- fb27e8976 `beebox/test/core/card-lint.doctest.md`: an extfile `href` is not a path leak; the leak elsewhere in the same card still errors.
- 096e696e6 `pairing-store-concurrency.doctest.md`: "An unreadable store fails closed — a write never clobbers it"; "Large store round-trips intact (looped writeSync lands the whole buffer)".
- c3864277a: "The husk's `engine` stamp outranks the per-checkout history file".
- 64a080433: "A sealed session refuses new media"; "The small lane runs alongside the bulk lane".
- 43982168a `init-v2.doctest.md`: `typeof pkg.dependencies["zod"] => string` with prose naming the silent-skip symptom.

Non-replay fixes:
- 6a15ede62 `(pre-rename package)/test/core/screenshot.doctest.md`: path flattened from `tmp/screenshots/<id>.png` to `tmp/screenshot-<id>.png`; the test's three path strings were updated, but nothing checks that housekeeping now reaches the file.
- 8d5ce3422 `(pre-rename package)/test/file-version.doctest.md`: tests the new `bustImageSrc` helper, not the stale-image symptom.

Reading. When a fix commit touches tests at all, it nearly always (22/24) adds a check that names the failure. The gap is the other half of fix commits that touch no test, concentrated in frontend/iOS/tooling code.

## 4. Deleted tests

`git log --no-merges --diff-filter=D --name-only -- '*.test.ts' '*.doctest.md'`: 1,274 deletion events in 79 commits. 1,103 are on 2026-10-18 (the doctest files deleted by the conversion and the "Remove the doctest format" commit; the .test.ts replacements are additions, so these are renames git did not detect). 10 more are in other mechanical commits. 37 are on 2026-10-08 (test cleanup sweep: `a056a2c39 Test cleanup: drop tests of in-memory fakes`, and `81c647230 Retire every box data migration`, 30 files).

Non-mechanical, non-10-08 deletions: 159 files in 64 commits. By month: Mar 7, Apr 2, May 15, Jun 13, Jul 18, Aug 16, Sep 28, Oct 60 (Oct includes the 10-08 sweep).

Largest: 81c647230 Retire every box data migration (30), bec8749e3 retire the legacy draft/go publication flow (13), 1130a7fed delete the cardworks package (10), 8237442f6 delete the v2->v3 one-root conversion (8), 78e5a5da7 Remove the Activities system (8), 33bb72dc6 Delete the news subsystem (6), db2ed9364 Use SDK-backed Claude quota cache (6), 9ceffa0c9 Remove Telegram (4), cd650c6ca delete the manifest scheme (4).

Sample of 20 deletion commits outside the sweep (seed 3), with reason from the message:

| hash | date | files | reason |
|---|---|---|---|
| 966dd572e | 08-22 | 1 | feature folded: one "Add files…" menu entry (photo-batch-threshold test gone with the threshold) |
| 0b0826c75 | 10-16 | 1 | smoke test rewritten (open card by URL instead of clicking) |
| 7bc295ad2 | 10-10 | 2 | exposition compiler removed (plugins) |
| a18921628 | 09-10 | 1 | deliver-late voice recording removed |
| d020cfe43 | 09-10 | 1 | late HQ correction removed from voice sends |
| 898699ab6 | 07-02 | 3 | dead raw routes superseded by tRPC |
| d7d3a19d3 | 09-04 | 1 | one-root layout replaced serve-resolve-box-root |
| 6e389a02f | 07-11 | 2 | legacy getBoxShape fallback deleted |
| fabbb2608 | 08-15 | 1 | dev/ scripted-app CSP exemption retired |
| 456eb3f11 | 10-06 | 1 | src/publications area no longer shipped |
| 969d97fa5 | 09-14 | 2 | migration/deployment/reload maintenance unified |
| 78e5a5da7 | 05-14 | 8 | Activities system removed |
| 9819c60c5 | 10-06 | 2 | landmark/folder menus given one job each (native box switching removed) |
| 575085237 | 08-19 | 1 | revert of an inline-images fix |
| 0ce0fd0e2 | 08-24 | 1 | superseded sweep implementation test |
| 9ceffa0c9 | 10-10 | 4 | Telegram removed |
| 3acec8cdb | 09-29 | 1 | run-status folded into status fields |
| ba3bf4367 | 08-05 | 1 | gmail-gc replaced by tracked working set |
| 6be8f161c | 06-18 | 1 | clerk Save Page / Do Page / memo actions removed |
| cd650c6ca | 09-14 | 4 | manifest annex scheme deleted |

Reading. Every sampled deletion outside the sweep is the test following its subject out of the codebase (feature or subsystem removed, dead path deleted, one revert). None is "the test was wrong/annoying so it was removed". The only deliberate pruning of live tests is the 10-08 sweep (`drop tests of in-memory fakes`, `drop static markup/prose checks`, `trim duplicate and restating examples`).

## What git history cannot tell

- Worktree branches merge with full history, not squashed: `git log --merges -5` shows `Merge branch 'worktree-retrospective'` (7508d99a2, 2 inner commits), `worktree-risky-merge-review` (9ca9bfac5, 19 inner commits), `worktree-gmail-404-stuck`. 2,062 merges against 8,024 non-merge commits. So intra-branch iteration is visible, but only at commit granularity: a test that failed, caused a code edit, and passed before the commit leaves no trace. The in-development catch rate (a test going red while an agent edits) is invisible here.
- A test that never changed (24.6%) is ambiguous: it may be guarding stable behavior or testing something nobody touches. Age-stratified rates (37% at <30 d, 7% at >180 d) say the first group shrinks with time; the test ledger / failure history, not git, would say whether any of them ever went red.
- "Co-changed with source" in a 12-file commit does not prove the test exercised that source. The same-basename measure (52.7% of tests) is narrower but misses tests named after a feature rather than a module.
- The classification in sections 2 and 3 is one reader's judgment over diffs; the (a)/(b) boundary is the main ambiguity (a bug fix that changes a return type reads as (a)).
- The "Strengthen test checks" sweep of 10-18 (five commits, 596 files, 592 of them current tests = 44%) is treated as mechanical, but it changed assertion strength in bulk. If counted as test-only edits it would raise the "≥1 test-only edit" share from 13% to 49% of files (657), with no per-file decision behind any of those edits.
- Flake history (how often a (d) hardening was preceded by a failed run) is in the schedule/ledger stores, not git.
- Git cannot distinguish a (c) edit that took 10 seconds from one that cost an hour of a worktree; the 6d0ec43f7 case (a separate one-line commit) suggests the full-HTML snapshot broke a later finish and had to be chased.
