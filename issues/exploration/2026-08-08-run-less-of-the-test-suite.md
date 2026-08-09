---
title: "Run less of the full suite — map changes to the tests that could break"
area: callback-box
needs: [design]
design: ../../callback-box/docs/plans/change-based-test-selection.md
labels: [testing, developer-experience]
---

> **Design written 2026-08-08, twice reviewed** —
> [change-based test selection](../../callback-box/docs/plans/change-based-test-selection.md)
> settles the mechanism (an import graph derived from the tree with esbuild, not
> recorded at runtime), the trust model (selection applies only when every
> changed path is accounted for by the graph; anything else runs everything), and
> where selection applies (the worktree iteration loop; the merge gate keeps
> running the full suite while shadow mode measures what selection would have
> skipped). It is **not implemented**, and it opens with a measurement gate that
> can end it: if most real commits touch a path no test imports, the plan is not
> worth building and the per-file cost floor is the better investment. Sections
> below that the plan supersedes: the option survey (it records why
> coverage-based, affected-package, directory-heuristic, and runtime-recorded
> selection were each rejected) and the "measure first" constraint (the
> `## Research (2026-08-08)` section satisfied it). The `needs: [design]` flag
> stays until the measurement gate resolves.

Every verification runs everything. `/finish` runs the full suite on each land,
agents run it before committing, and a re-run after a post-green fix runs it
again. Most of that is provably irrelevant to the diff — a frontend tweak does
not need the connector doctests — but we have no way to know which part *is*
relevant, so we pay for all of it every time.

Scale of the thing (`callback-box/.taprc`, `package.json:52`):

- **480 `.doctest.md` files** plus 2 `.test.ts` under `callback-box/test/`, and
  19 `.test.ts` under `bin/` — roughly 2231 assertions.
- `jobs: 6` (deliberately half the cores: `makeTestServer()` boots a full
  Fastify app plus two synchronous `git` spawns, and at full core-count
  parallelism the thundering herd thrashes the machine into non-deterministic
  SIGALRM timeouts).
- `timeout: 300` per file, raised because **a single route file is ~80s solo**.

So the suite is slow for structural reasons that won't be tuned away, and the
cost lands on the tightest loop we have.

## Why this is research, not a task

The obvious approach — "map source files to the tests that exercise them" — has
several real implementations with different trade-offs, and picking wrong is
worse than not doing it, because a selection bug shows up as a regression that
shipped, not as a failing test. Worth surveying before designing:

- **Coverage-based selection.** Run the suite once with coverage, record which
  source files each test file touched, then select tests whose touched files
  appear in the diff. Language-agnostic and precise. `tap --coverage` already
  exists (coverage is merely disabled by default here — see the `.taprc`
  rationale), so the raw capability is present.
- **Import-graph selection.** What Jest (`--onlyChanged`/`--changedSince`) and
  Vitest (`--changed`) do: walk the static import graph from each test. Cheaper
  to maintain, but blind to runtime coupling — and our doctests reach a lot of
  behavior through a booted server rather than a direct import.
- **Affected-package graphs.** Nx/Turborepo/Bazel style, at package granularity.
  Coarse, but this is a monorepo with real package boundaries
  (`callback-box`/`agent-doctest`/`bin`/`canvas-loop`), so a cheap first cut
  might just be "which packages did the diff touch."
- **Test Impact Analysis** as a named industry practice (Microsoft shipped this
  for .NET/Azure DevOps) — worth reading for how they handle the safety problem
  of a stale map.

## What's specific to us

- **We own the runner.** `agent-doctest/` is ours, so per-doctest instrumentation
  is available in a way it wouldn't be with a third-party runner. That may be the
  decisive advantage.
- **Doctests are markdown**, so "which source does this test import" isn't a
  static-analysis freebie — it means analyzing the code blocks, or measuring at
  runtime.
- **Subprocess attribution is hard.** Doctests spawn servers and `git`; coverage
  that only sees the parent process will under-attribute.
- **Prior art in-repo:** `/finish`'s docs-only fast path already does a crude
  version of this — if every changed path is under a `docs/` dir and none is a
  `.doctest.md`, skip the whole verification tier. It works because the rule is
  conservative and path-precise. That's the shape to generalize.

## Constraints any design must respect

- **Wrong selection = a missed regression.** Whatever we build needs a safety
  net: full suite at some gate (pre-merge, or on `main`), selected suite on the
  iteration loop. Never selected-only everywhere.
- **A stale map fails open, not closed.** If the map doesn't know about a file,
  it must run more tests, not fewer.
- Measure first. Nobody has profiled where the time actually goes; it may be
  concentrated in a handful of route files, in which case targeted fixes to
  those could beat a selection system entirely.

Related: [flaky login-redirect doctest](../bugs/2026-07-29-flaky-login-redirect-doctest.md)
(parallel-load flakes are the same contention this would reduce).

## Research (2026-08-08)

These measurements ran in the `test-timing` worktree on a 12-core Mac with
Node 24.18.0. TAP emitted each file duration in raw TAP as
`ok N - test/path # time=Nms`; `--output-file` preserved those records for the
ranking below.

The machine was not quiet. At the start, load average was 17.92, 18.25, 16.12.
Swap used 16.2 of 17.4 GB. A broad process-name count found 37 Claude or Codex
processes. At the end, load average was 9.24, 21.98, 22.02, swap used 16.9 of
18.4 GB, and the same count was 33. Treat the full-run times as upper bounds.

### Full run and per-file ranking

The callback-box TAP run took 566.5 seconds at `jobs: 6`, excluding a measured
0.3-second pretest CLI build. It was not green: 13 frontend doctest processes
reported `1..0 # no tests found`. The same 13 files passed together at
`jobs=1` immediately afterward. This is consistent with load-sensitive runner
or loader behavior, but the run did not capture enough diagnostics to identify
the cause.
The repository-root `pnpm test` (the 19 `bin/*.test.ts` files) took 2.60 seconds
and had two pre-existing `router-auth.test.ts` assertion failures. Therefore,
there is no trustworthy green total-suite baseline from this loaded machine.
Those assertions exposed a real pairing-redeem classifier regression rather
than bad tests. It was fixed after this profiling run in `03f46268`; the focused
router-auth file and the 220-test root suite are green on the current baseline.

The loaded callback-box run ranked these files highest:

| Rank | File | Loaded time | `makeTestServer()` calls |
| ---: | --- | ---: | ---: |
| 1 | `test/hub/hub-e2e.doctest.md` | 110.8 s | 0 |
| 2 | `test/webapp/chat-send-run-start-failure.doctest.md` | 68.5 s | 4 |
| 3 | `test/webapp/routes/scan-upload.doctest.md` | 58.2 s | 10 |
| 4 | `test/webapp/trpc-chat-bootstrap.doctest.md` | 48.2 s | 1 |
| 5 | `test/webapp/session-gen.doctest.md` | 46.0 s | 1 |
| 6 | `test/webapp/routes/routes-figure.doctest.md` | 44.8 s | 11 |
| 7 | `test/webapp/routes/routes-views.doctest.md` | 44.6 s | 5 |
| 8 | `test/webapp/scan-auth.doctest.md` | 43.4 s | 1 |
| 9 | `test/webapp/routes/routes-google-oauth-callback.doctest.md` | 39.8 s | 2 |
| 10 | `test/webapp/trpc-admin-box-config.doctest.md` | 39.6 s | 0 |

All 480 executed file durations (478 doctests after excluding two manual files,
plus two `.test.ts` files) summed to 3,374.8 file-seconds. The top ten summed to
543.9 file-seconds, or 16.1%. The run occupied 99.3% of its six theoretical job
slots: `3,374.8 / (566.5 * 6)`. At that saturation, eliminating the top ten's
work would ideally save about 90.7 wall-clock seconds, also 16.1%. The failed
zero-test processes mean the aggregate omits their real test work, so treat
this share as approximate. The distribution is still a long tail. There is no
large scheduling or end-of-run straggler win hidden in this run.

Solo runs show how much contention distorted the ranking:

| File | Loaded | Solo |
| --- | ---: | ---: |
| `hub/hub-e2e.doctest.md` | 110.8 s | 8.4 s |
| `webapp/chat-send-run-start-failure.doctest.md` | 68.5 s | 24.9 s |
| `webapp/routes/scan-upload.doctest.md` | 58.2 s | 12.9 s |
| `webapp/routes/routes-figure.doctest.md` | 44.8 s | 11.0 s |
| `webapp/routes/routes-views.doctest.md` | 44.6 s | 13.2 s |
| `webapp/routes/bulk-upload-routes.doctest.md` | 29.3 s | 9.0 s |
| `webapp/routes/routes-api.doctest.md` | 29.4 s | 6.3 s |

`chat-send-run-start-failure` is the clearest intrinsically slow file in this
sample. `hub-e2e` is the opposite: its loaded time is mostly contention.

### Server boot cost and repeated setup

The rationale in `.taprc` and in the issue body is stale in one important way.
`test/helpers/test-server.ts` now builds one initialized template box per test
process. It pays for `scaffoldV2Box()` and one shell containing `git init`,
`git add`, and `git commit` once, then clones the template with `fs.cp()` for
each later `makeTestServer()` call. It does not run two synchronous Git spawns
on every server boot.

A direct ten-boot probe in one process measured a 1,023.6 ms cold boot. The
next nine warm boots averaged 387.4 ms (332.5 ms median). Cleanup averaged
69.6 ms. Thus `bulk-upload-routes`, with 13 calls, spends approximately 6.6
seconds in measured boot plus cleanup, while a file with one call spends about
1.1 seconds. Reusing one server within a file could still help some route files,
but tests often need
isolated server state. The existing process-local template already removes the
largest safe redundancy.

There are 122 static `makeTestServer()` calls across 37 doctest files. Each file
is a separate process, so each pays the cold template build once. Sharing a
mutable Git repository or Fastify instance across processes would introduce
isolation and concurrency risks. A persistent immutable template outside the
test processes might remove some cold setup, but the measured one-second ceiling
per affected file makes it a secondary optimization.

`makeTmpBox({ git: true })` still initializes Git independently for filesystem
tests. `makeTmpBox({ deps: true })` uses symlinks. Searches found no real package
install in the doctest suite; comments explicitly avoid it. There is no repeated
`pnpm install` cost to cache. Route tests can also call `commitAll()`, which
runs synchronous `git add` and `git commit` commands. This measurement did not
separate those commits from the test body, so Git can still be a hot-path cost
even though server boot no longer initializes Git each time.

The `.taprc` comments also say `routes-api` takes about 80 seconds solo. It took
6.3 seconds in this sample. The slowest sampled solo file took 24.9 seconds.
Those results do not justify changing the 300-second timeout by themselves, but
the comment's timing should be refreshed on a quiet machine.

### Parallelism

A fixed cohort contained `bulk-upload-routes`, `routes-figure`, `scan-upload`,
`screenshot`, `capture-routes`, `chat-send-routes-validation`,
`routes-external`, `routes-views`, `routes-api`, and
`chat-send-run-start-failure`. It took 49.40 seconds at configured `jobs=1`,
19.51 seconds at `jobs=6`, and 22.17 seconds at `jobs=12`. All three cohort runs
were green. Because the cohort had only ten files, the last run exercised at
most ten concurrent jobs, not twelve. It also ran on an already oversubscribed
machine. The higher setting used more CPU and system time (`50.4/35.7` versus
`43.1/25.2` user/system seconds) without improving wall time, but this experiment
cannot establish the quiet-machine optimum or revalidate SIGALRM flake rates.
It provides no basis to change the current cap. A trustworthy comparison needs
more than 12 files, a quiet machine, and repeated green full-suite runs.

### Conclusion

The suite cost is a long tail amplified by machine contention. The top ten are
only 16.1% of aggregate file time, and loaded rankings can misidentify victims
such as `hub-e2e` as intrinsic offenders. Do not change `jobs: 6` from these
data; the parallelism experiment is not a clean revalidation. A targeted fix to
`chat-send-run-start-failure` and cautious within-file server reuse could save
some time, but neither replaces change-based selection. The strongest next
measurement is a green full run on a quiet machine, followed by the same raw-TAP
ranking, before using these upper-bound numbers as a design baseline.

### Complete loaded-run ranking

<details>
<summary>All 480 executed test files, slowest first</summary>

These are the per-file TAP durations from the same loaded, non-green run. The
13 entries marked `zero tests` exited with `1..0 # no tests found`; they
measure process time only, not the cost of executing their tests.

| Rank | File | Time | Result |
| ---: | --- | ---: | --- |
| 1 | `test/hub/hub-e2e.doctest.md` | 110.824 s | pass |
| 2 | `test/webapp/chat-send-run-start-failure.doctest.md` | 68.515 s | pass |
| 3 | `test/webapp/routes/scan-upload.doctest.md` | 58.177 s | pass |
| 4 | `test/webapp/trpc-chat-bootstrap.doctest.md` | 48.239 s | pass |
| 5 | `test/webapp/session-gen.doctest.md` | 46.031 s | pass |
| 6 | `test/webapp/routes/routes-figure.doctest.md` | 44.752 s | pass |
| 7 | `test/webapp/routes/routes-views.doctest.md` | 44.608 s | pass |
| 8 | `test/webapp/scan-auth.doctest.md` | 43.358 s | pass |
| 9 | `test/webapp/routes/routes-google-oauth-callback.doctest.md` | 39.752 s | pass |
| 10 | `test/webapp/trpc-admin-box-config.doctest.md` | 39.630 s | pass |
| 11 | `test/webapp/trpc-chat-by-landmark.doctest.md` | 36.538 s | pass |
| 12 | `test/webapp/routes/routes-files-write.doctest.md` | 35.711 s | pass |
| 13 | `test/webapp/trpc-connector-config.doctest.md` | 35.652 s | pass |
| 14 | `test/webapp/trpc-clerk.doctest.md` | 33.869 s | pass |
| 15 | `test/webapp/routes/routes-external.doctest.md` | 30.748 s | pass |
| 16 | `test/webapp/trpc-health-box-growth.doctest.md` | 29.742 s | pass |
| 17 | `test/webapp/trpc-actions.doctest.md` | 29.499 s | pass |
| 18 | `test/core/screenshot.doctest.md` | 29.445 s | pass |
| 19 | `test/webapp/routes/routes-api.doctest.md` | 29.426 s | pass |
| 20 | `test/webapp/routes/bulk-upload-routes.doctest.md` | 29.262 s | pass |
| 21 | `test/webapp/trpc-landmarks-list.doctest.md` | 27.736 s | pass |
| 22 | `test/webapp/routes/capture-routes.doctest.md` | 26.769 s | pass |
| 23 | `test/webapp/debug-log-submit.doctest.md` | 26.705 s | pass |
| 24 | `test/webapp/history-blob-annex.doctest.md` | 25.414 s | pass |
| 25 | `test/services/scan-vision-claude-integration.doctest.md` | 25.060 s | pass |
| 26 | `test/core/procedure/procedure-engine.doctest.md` | 24.919 s | pass |
| 27 | `test/webapp/routes/routes-actions.doctest.md` | 23.850 s | pass |
| 28 | `test/core/commands/document-extract-integration.doctest.md` | 23.714 s | pass |
| 29 | `test/cli/commands/view-test-command.doctest.md` | 23.335 s | pass |
| 30 | `test/webapp/password-login.doctest.md` | 22.279 s | pass |
| 31 | `test/webapp/password-reset.doctest.md` | 22.211 s | pass |
| 32 | `test/webapp/healthz-schema-failures.doctest.md` | 22.030 s | pass |
| 33 | `test/webapp/invite-accept.doctest.md` | 21.948 s | pass |
| 34 | `test/webapp/password-change.doctest.md` | 21.901 s | pass |
| 35 | `test/webapp/routes/api-csp-report-bounds.doctest.md` | 21.874 s | pass |
| 36 | `test/core/box/file-watcher.doctest.md` | 21.168 s | pass |
| 37 | `test/webapp/history-blob-paths.doctest.md` | 21.126 s | pass |
| 38 | `test/webapp/chat-send-routes-validation.doctest.md` | 21.111 s | pass |
| 39 | `test/hub/hub-scan-token.doctest.md` | 20.137 s | pass |
| 40 | `test/webapp/healthz-engine-version.doctest.md` | 20.087 s | pass |
| 41 | `test/webapp/hub-mode-auth.doctest.md` | 19.925 s | pass |
| 42 | `test/hub/hub-server-auth.doctest.md` | 19.807 s | pass |
| 43 | `test/cli/lib/init-v2.doctest.md` | 19.692 s | pass |
| 44 | `test/webapp/routes/frozen-serve.doctest.md` | 18.799 s | pass |
| 45 | `test/webapp/login-redirect.doctest.md` | 18.600 s | pass |
| 46 | `test/cli/lib/self-note.doctest.md` | 18.283 s | pass |
| 47 | `test/webapp/routes/routes-api-adapters.doctest.md` | 18.220 s | pass |
| 48 | `test/webapp/push-subscribe.doctest.md` | 18.086 s | pass |
| 49 | `test/webapp/trpc-scheduler.doctest.md` | 17.826 s | pass |
| 50 | `test/webapp/trpc-scan-tokens.doctest.md` | 17.540 s | pass |
| 51 | `test/core/scan/promote.doctest.md` | 17.524 s | pass |
| 52 | `test/hub/hub-router.doctest.md` | 17.294 s | pass |
| 53 | `test/webapp/login-page.doctest.md` | 17.002 s | pass |
| 54 | `test/webapp/location-capture.doctest.md` | 16.690 s | pass |
| 55 | `test/scripts/migrate/migrate-todo-list-to-doc.doctest.md` | 16.270 s | pass |
| 56 | `test/cli/commands/wakeup-helpers.doctest.md` | 15.519 s | pass |
| 57 | `test/webapp/trpc-share.doctest.md` | 15.121 s | pass |
| 58 | `test/webapp/auth-required.doctest.md` | 14.530 s | pass |
| 59 | `test/cli/commands/serve-dev-args.doctest.md` | 14.263 s | pass |
| 60 | `test/core/agent-token.doctest.md` | 14.219 s | pass |
| 61 | `test/core/capture/prepare.doctest.md` | 13.901 s | pass |
| 62 | `test/webapp/chat-sessions-label.doctest.md` | 13.887 s | pass |
| 63 | `test/cli/commands/serve-resolve-box-root.doctest.md` | 13.749 s | pass |
| 64 | `test/core/commands/answer-command.doctest.md` | 13.257 s | pass |
| 65 | `test/scripts/migrate/migrate-webpage-card.doctest.md` | 12.827 s | pass |
| 66 | `test/hub/supervisor.doctest.md` | 12.639 s | pass |
| 67 | `test/webapp/trpc-todos-list.doctest.md` | 12.503 s | pass |
| 68 | `test/schemas/personality-boxholder.doctest.md` | 12.369 s | pass |
| 69 | `test/core/last-audio.doctest.md` | 12.297 s | pass |
| 70 | `test/cli/commands/view-check.doctest.md` | 12.159 s | pass |
| 71 | `test/webapp/health-claude-auth.doctest.md` | 12.118 s | pass |
| 72 | `test/connectors/connector-drive-docs.doctest.md` | 11.838 s | pass |
| 73 | `test/webapp/capture-pending-sessions.doctest.md` | 11.526 s | pass |
| 74 | `test/core/commands/document-extract.doctest.md` | 11.272 s | pass |
| 75 | `test/schemas/pub-submission.doctest.md` | 11.259 s | pass |
| 76 | `test/cli/lib/init.doctest.md` | 11.116 s | pass |
| 77 | `test/cli/commands/trick.doctest.md` | 11.058 s | pass |
| 78 | `test/webapp/api-files-serving-hardening.doctest.md` | 11.041 s | pass |
| 79 | `test/webapp/health-git-writable.doctest.md` | 10.714 s | pass |
| 80 | `test/core/maps/maps-precheck.doctest.md` | 10.563 s | pass |
| 81 | `test/connectors/connector-gmail-pull.doctest.md` | 10.517 s | pass |
| 82 | `test/core/annex/to-annex.doctest.md` | 10.200 s | pass |
| 83 | `test/connectors/connector-gmail-drafts.doctest.md` | 9.919 s | pass |
| 84 | `test/connectors/connector-google-calendar.doctest.md` | 9.903 s | pass |
| 85 | `test/webapp/trpc-nav-status.doctest.md` | 9.786 s | pass |
| 86 | `test/cli/lib/git.doctest.md` | 9.752 s | pass |
| 87 | `test/core/reactor-integration.doctest.md` | 9.722 s | pass |
| 88 | `test/schemas/question.doctest.md` | 9.635 s | pass |
| 89 | `test/webapp/views-compiler-v2.doctest.md` | 9.635 s | pass |
| 90 | `test/cli/lib/view-lint-hooks.doctest.md` | 9.630 s | pass |
| 91 | `test/core/scheduler.doctest.md` | 9.530 s | pass |
| 92 | `test/core/commands/dismiss-command.doctest.md` | 9.481 s | pass |
| 93 | `test/connectors/connector-drive.doctest.md` | 9.356 s | pass |
| 94 | `test/schemas/place.doctest.md` | 9.347 s | pass |
| 95 | `test/cli/lib/session-retention.doctest.md` | 9.048 s | pass |
| 96 | `test/core/chat-session-with-spawner.doctest.md` | 8.943 s | pass |
| 97 | `test/webapp/api-files-annex-absent.doctest.md` | 8.813 s | pass |
| 98 | `test/core/chat-session-transcript-sync.doctest.md` | 8.687 s | pass |
| 99 | `test/core/commands/connector-sync.doctest.md` | 8.606 s | pass |
| 100 | `test/service-openai-embeddings.doctest.md` | 8.565 s | pass |
| 101 | `test/webapp/health-engine.doctest.md` | 8.443 s | pass |
| 102 | `test/connectors/connector-telegram.doctest.md` | 8.364 s | pass |
| 103 | `test/core/chat-session.doctest.md` | 8.348 s | pass |
| 104 | `test/core/capture/sweep.doctest.md` | 8.305 s | pass |
| 105 | `test/services/service-claude-chat.doctest.md` | 8.186 s | pass |
| 106 | `test/webapp/views-compiler.doctest.md` | 8.058 s | pass |
| 107 | `test/core/bulk-upload/prepare.doctest.md` | 7.933 s | pass |
| 108 | `test/webapp/mobile-spa-fallback.doctest.md` | 7.903 s | pass |
| 109 | `test/scripts/migrate/migrate-retire-process-captures.doctest.md` | 7.740 s | pass |
| 110 | `test/connectors/telegram-webhook.doctest.md` | 7.678 s | pass |
| 111 | `test/core/agent-session.doctest.md` | 7.644 s | pass |
| 112 | `test/core/chat-session-run-start-failure.doctest.md` | 7.604 s | pass |
| 113 | `test/core/procedure/procedure-agent.doctest.md` | 7.524 s | pass |
| 114 | `test/cards/ref-fields.doctest.md` | 7.503 s | pass |
| 115 | `test/schemas/todo-view.doctest.md` | 7.502 s | pass |
| 116 | `test/webapp/auth-capabilities.doctest.md` | 7.480 s | pass |
| 117 | `test/core/bulk-upload/worker.doctest.md` | 7.431 s | pass |
| 118 | `test/core/todo-review-sweep.doctest.md` | 7.378 s | pass |
| 119 | `test/webapp/routes/ls-format.doctest.md` | 7.358 s | pass |
| 120 | `test/webapp/chat-default-route.doctest.md` | 7.323 s | pass |
| 121 | `test/core/procedure/procedure-review-retry.doctest.md` | 7.323 s | pass |
| 122 | `test/core/schedule-health-alert.doctest.md` | 7.313 s | pass |
| 123 | `test/core/search/contains-evidence.doctest.md` | 7.216 s | pass |
| 124 | `test/core/chat-session-registry.doctest.md` | 7.208 s | pass |
| 125 | `test/schemas/question-followup-job.doctest.md` | 7.082 s | pass |
| 126 | `test/core/capture/deliver-message.doctest.md` | 7.035 s | pass |
| 127 | `test/core/search/contains-state.doctest.md` | 7.016 s | pass |
| 128 | `test/webapp/extension-cors.doctest.md` | 6.999 s | pass |
| 129 | `test/schemas/view-card.doctest.md` | 6.979 s | pass |
| 130 | `test/cli/commands/contains-backfill.doctest.md` | 6.976 s | pass |
| 131 | `test/core/command-streaming.doctest.md` | 6.971 s | pass |
| 132 | `test/webapp/health-google.doctest.md` | 6.905 s | pass |
| 133 | `test/core/commands/scan-import-photo-flow.doctest.md` | 6.811 s | pass |
| 134 | `test/core/chat-session-delete.doctest.md` | 6.739 s | pass |
| 135 | `test/schemas/schemas.doctest.md` | 6.696 s | pass |
| 136 | `test/webapp/csp-headers.doctest.md` | 6.611 s | pass |
| 137 | `test/core/triage.doctest.md` | 6.607 s | pass |
| 138 | `test/core/mobile/pairing-store-concurrency.doctest.md` | 6.448 s | pass |
| 139 | `test/package-exports.doctest.md` | 6.414 s | pass |
| 140 | `test/location-resolve.doctest.md` | 6.393 s | pass |
| 141 | `test/location-mark.doctest.md` | 6.350 s | pass |
| 142 | `test/webapp/trpc-status-onplate.doctest.md` | 6.345 s | pass |
| 143 | `test/core/procedure/procedure-instruction-validation.doctest.md` | 6.260 s | pass |
| 144 | `test/location-format.doctest.md` | 6.124 s | pass |
| 145 | `test/core/validation-ignore.doctest.md` | 6.118 s | pass |
| 146 | `test/core/annex/doctor.doctest.md` | 6.063 s | pass |
| 147 | `test/connectors/push-output-cards.doctest.md` | 6.049 s | pass |
| 148 | `test/core/search/search-hybrid-query.doctest.md` | 5.937 s | pass |
| 149 | `test/core/commands/move-command.doctest.md` | 5.905 s | pass |
| 150 | `test/cli/commands/view-typecheck.doctest.md` | 5.867 s | pass |
| 151 | `test/schemas/box-schemas-v2.doctest.md` | 5.851 s | pass |
| 152 | `test/core/search/search-crash-safety.doctest.md` | 5.836 s | pass |
| 153 | `test/core/search/search-embeddings.doctest.md` | 5.815 s | pass |
| 154 | `test/core/chat-thread-session-messages.doctest.md` | 5.653 s | pass |
| 155 | `test/core/search/search-index.doctest.md` | 5.646 s | pass |
| 156 | `test/core/schedule-health.doctest.md` | 5.639 s | pass |
| 157 | `test/core/schedule-state.doctest.md` | 5.621 s | pass |
| 158 | `test/connectors/telegram-output-cards.doctest.md` | 5.612 s | pass |
| 159 | `test/core/script-env.doctest.md` | 5.603 s | pass |
| 160 | `test/location-store.doctest.md` | 5.596 s | pass |
| 161 | `test/services/google-drive-schemas.doctest.md` | 5.596 s | pass |
| 162 | `test/webapp/trpc-status-questions.doctest.md` | 5.594 s | pass |
| 163 | `test/core/reactor-cycle.doctest.md` | 5.580 s | pass |
| 164 | `test/services/tailscale.doctest.md` | 5.540 s | pass |
| 165 | `test/webapp/mobile-cookie.doctest.md` | 5.469 s | pass |
| 166 | `test/connectors/gmail-tracking.doctest.md` | 5.345 s | pass |
| 167 | `test/services/scan-vision-claude.doctest.md` | 5.301 s | pass |
| 168 | `test/core/bulk-upload/sweep.doctest.md` | 5.231 s | pass |
| 169 | `test/services/claude-chat-content.doctest.md` | 5.179 s | pass |
| 170 | `test/webapp/first-run-setup-owner.doctest.md` | 5.164 s | pass |
| 171 | `test/core/maps/maps-finalize.doctest.md` | 5.150 s | pass |
| 172 | `test/core/reactor.doctest.md` | 5.126 s | pass |
| 173 | `test/schemas/tab-arrangement.test.ts` | 5.121 s | pass |
| 174 | `test/lib/file-lock.doctest.md` | 5.119 s | pass |
| 175 | `test/core/annex/info-attributes.doctest.md` | 5.115 s | pass |
| 176 | `test/cli/lib/session-oversize-lines.doctest.md` | 5.101 s | pass |
| 177 | `test/schemas/document.doctest.md` | 5.003 s | pass |
| 178 | `test/core/view-cards.doctest.md` | 4.991 s | pass |
| 179 | `test/core/scan/quarantine.doctest.md` | 4.864 s | pass |
| 180 | `test/core/question-aging.doctest.md` | 4.817 s | pass |
| 181 | `test/shared/markdoc-headings.doctest.md` | 4.762 s | pass |
| 182 | `test/shared/markdoc-redacted.doctest.md` | 4.684 s | pass |
| 183 | `test/webapp/routes/chat-schedule-fire.doctest.md` | 4.676 s | pass |
| 184 | `test/cli/todos.doctest.md` | 4.662 s | pass |
| 185 | `test/publish/lifecycle.doctest.md` | 4.636 s | pass |
| 186 | `test/scripts/migrate/migrate-delete-deprecated.doctest.md` | 4.619 s | pass |
| 187 | `test/shared/markdoc-source.doctest.md` | 4.577 s | pass |
| 188 | `test/core/chat/review/run.doctest.md` | 4.574 s | pass |
| 189 | `test/core/chat-whats-changed.doctest.md` | 4.568 s | pass |
| 190 | `test/publish/setup.doctest.md` | 4.564 s | pass |
| 191 | `test/services/tailscale-setup.doctest.md` | 4.548 s | pass |
| 192 | `test/webapp/local-users.doctest.md` | 4.531 s | pass |
| 193 | `test/core/session-context.doctest.md` | 4.521 s | pass |
| 194 | `test/core/todo-ambient-summary.doctest.md` | 4.509 s | pass |
| 195 | `test/publish/go.doctest.md` | 4.505 s | pass |
| 196 | `test/webapp/box-config-write.doctest.md` | 4.487 s | pass |
| 197 | `test/core/scan/tokens.doctest.md` | 4.485 s | pass |
| 198 | `test/core/notify-boxholder.doctest.md` | 4.447 s | pass |
| 199 | `test/lib/asset-content.doctest.md` | 4.433 s | pass |
| 200 | `test/connectors/transient-state.doctest.md` | 4.390 s | pass |
| 201 | `test/lib/box-tmp.doctest.md` | 4.381 s | pass |
| 202 | `test/publish/status.doctest.md` | 4.340 s | pass |
| 203 | `test/core/todo-collect.doctest.md` | 4.338 s | pass |
| 204 | `test/dev/lib/test-runner.doctest.md` | 4.336 s | pass |
| 205 | `test/core/search/search-extract.doctest.md` | 4.327 s | pass |
| 206 | `test/scripts/release-manifest.doctest.md` | 4.317 s | pass |
| 207 | `test/scripts/migrate/migrate-person-contact-split.doctest.md` | 4.312 s | pass |
| 208 | `test/webapp/trpc-procedures.doctest.md` | 4.305 s | pass |
| 209 | `test/webapp/static-asset-cache.doctest.md` | 4.296 s | pass |
| 210 | `test/core/handle.doctest.md` | 4.290 s | pass |
| 211 | `test/services/tailscale-discovery.doctest.md` | 4.250 s | pass |
| 212 | `test/services/service-google-calendar.doctest.md` | 4.234 s | pass |
| 213 | `test/services/scan-vision.doctest.md` | 4.231 s | pass |
| 214 | `test/box-shape.doctest.md` | 4.229 s | pass |
| 215 | `test/services/service-google-gmail.doctest.md` | 4.228 s | pass |
| 216 | `test/cli/lib/session-multi-root.doctest.md` | 4.214 s | pass |
| 217 | `test/shared/delivered-user-message.doctest.md` | 4.210 s | pass |
| 218 | `test/core/scan-procedures.doctest.md` | 4.192 s | pass |
| 219 | `test/box-containment.doctest.md` | 4.152 s | pass |
| 220 | `test/lib/attach-lint.doctest.md` | 4.148 s | pass |
| 221 | `test/core/agent-guide-box-shape.doctest.md` | 4.095 s | pass |
| 222 | `test/scripts/migrate/migrate-strip-entry-timestamps.doctest.md` | 4.090 s | pass |
| 223 | `test/scripts/migrate/migrate-person-aliases.doctest.md` | 4.090 s | pass |
| 224 | `test/push-send.doctest.md` | 4.066 s | pass |
| 225 | `test/cli/commands/validate-markdown.doctest.md` | 4.019 s | pass |
| 226 | `test/schemas/scheduled-script.doctest.md` | 4.017 s | pass |
| 227 | `test/shared/card-name.doctest.md` | 3.914 s | pass |
| 228 | `test/core/transcription-config.doctest.md` | 3.902 s | pass |
| 229 | `test/scripts/migrate/migrate-question-lifecycle.doctest.md` | 3.890 s | pass |
| 230 | `test/shared/box-path.doctest.md` | 3.868 s | pass |
| 231 | `test/mobile-contract/fixtures.doctest.md` | 3.856 s | pass |
| 232 | `test/core/boxes-config.doctest.md` | 3.845 s | pass |
| 233 | `test/core/card-lint.doctest.md` | 3.820 s | pass |
| 234 | `test/services/service-openai-audio.doctest.md` | 3.809 s | pass |
| 235 | `test/core/install-validation-hooks.doctest.md` | 3.808 s | pass |
| 236 | `test/cli/commands/upgrade.doctest.md` | 3.786 s | pass |
| 237 | `test/scripts/migrate/migrate-recipe-source-shape.doctest.md` | 3.783 s | pass |
| 238 | `test/shared/markdoc-todo.doctest.md` | 3.707 s | pass |
| 239 | `test/core/google-auth-alert.doctest.md` | 3.697 s | pass |
| 240 | `test/core/markdown-link-rules.doctest.md` | 3.676 s | pass |
| 241 | `test/connectors/intake-utils.doctest.md` | 3.652 s | pass |
| 242 | `test/core/canonical-refs.doctest.md` | 3.633 s | pass |
| 243 | `test/core/box-schemas.doctest.md` | 3.630 s | pass |
| 244 | `test/publish/draft.doctest.md` | 3.602 s | pass |
| 245 | `test/core/commands/trash-command.doctest.md` | 3.551 s | pass |
| 246 | `test/connectors/publish-submissions.doctest.md` | 3.484 s | pass |
| 247 | `test/connectors/google-drive-state.doctest.md` | 3.421 s | pass |
| 248 | `test/cli/auth-command.doctest.md` | 3.419 s | pass |
| 249 | `test/webapp/health-snapshot.doctest.md` | 3.416 s | pass |
| 250 | `test/connectors/preserve-agent-fields.doctest.md` | 3.414 s | pass |
| 251 | `test/shared/image-orientation.doctest.md` | 3.402 s | pass |
| 252 | `test/core/question-alert.doctest.md` | 3.402 s | pass |
| 253 | `test/webapp/routes/chat-mobile-sender.doctest.md` | 3.360 s | pass |
| 254 | `test/hub/box-picker.doctest.md` | 3.351 s | pass |
| 255 | `test/core/chat/review/discovery.doctest.md` | 3.347 s | pass |
| 256 | `test/core/box-growth-health.doctest.md` | 3.304 s | pass |
| 257 | `test/core/procedure/procedure-gc.doctest.md` | 3.304 s | pass |
| 258 | `test/cli/lib/time.doctest.md` | 3.294 s | pass |
| 259 | `test/core/agent-guide-card-types.doctest.md` | 3.273 s | pass |
| 260 | `test/cli/commands/migrate-mark-applied.doctest.md` | 3.234 s | pass |
| 261 | `test/core/card-io.doctest.md` | 3.206 s | pass |
| 262 | `test/core/capture/staging-store.doctest.md` | 3.195 s | pass |
| 263 | `test/core/commands/pdf-probe.doctest.md` | 3.167 s | pass |
| 264 | `test/core/box.doctest.md` | 3.158 s | pass |
| 265 | `test/cards/todos-field.doctest.md` | 3.148 s | pass |
| 266 | `test/core/scan/promote-debounce.doctest.md` | 3.144 s | pass |
| 267 | `test/core/annex/is-annex-box.doctest.md` | 3.124 s | pass |
| 268 | `test/scripts/migrate/migrate-gsheet-rename.doctest.md` | 3.124 s | pass |
| 269 | `test/core/commands/command-args-validation.doctest.md` | 3.111 s | pass |
| 270 | `test/webapp/chat-landmark-summaries.doctest.md` | 3.080 s | pass |
| 271 | `test/publish/render-docs.doctest.md` | 3.079 s | pass |
| 272 | `test/hub/hub-config.doctest.md` | 3.048 s | pass |
| 273 | `test/scripts/migrate/migrate-normalize-ref-keys.doctest.md` | 3.043 s | pass |
| 274 | `test/core/mobile/mobile-session.doctest.md` | 3.040 s | pass |
| 275 | `test/cli/commands/tick-create-after-success.doctest.md` | 3.017 s | pass |
| 276 | `test/services/service-call-log.doctest.md` | 3.011 s | pass |
| 277 | `test/core/landmark/landmark-schema.doctest.md` | 2.988 s | pass |
| 278 | `test/lib/asset-extensions.doctest.md` | 2.978 s | pass |
| 279 | `test/services/service-telegram.doctest.md` | 2.969 s | pass |
| 280 | `test/core/chat/render-entries.doctest.md` | 2.960 s | pass |
| 281 | `test/core/annex/unlisted-binaries.doctest.md` | 2.905 s | pass |
| 282 | `test/core/chat-features-persistence.doctest.md` | 2.876 s | pass |
| 283 | `test/publish/pub-worker-meta.doctest.md` | 2.869 s | pass |
| 284 | `test/lib/card-lock.doctest.md` | 2.853 s | pass |
| 285 | `test/core/view-refs.doctest.md` | 2.851 s | pass |
| 286 | `test/lib/box-slug.doctest.md` | 2.850 s | pass |
| 287 | `test/core/link-repair.doctest.md` | 2.818 s | pass |
| 288 | `test/schemas/briefing-compile.doctest.md` | 2.796 s | pass |
| 289 | `test/webapp/routes/bulk-upload-stream-gate.doctest.md` | 2.793 s | pass |
| 290 | `test/webapp/routes/chat-image-orientation.doctest.md` | 2.771 s | pass |
| 291 | `test/core/asset-manifest-scan.doctest.md` | 2.765 s | pass |
| 292 | `test/cli/commands/tick-force.doctest.md` | 2.752 s | pass |
| 293 | `test/core/agent/auth-preflight.doctest.md` | 2.691 s | pass |
| 294 | `test/core/bulk-upload/upload-wrapper.doctest.md` | 2.680 s | pass |
| 295 | `test/lib/csp.doctest.md` | 2.649 s | pass |
| 296 | `test/core/chat-task-events.doctest.md` | 2.633 s | pass |
| 297 | `test/connectors/chat-utils.doctest.md` | 2.622 s | pass |
| 298 | `test/lib/exec-with-timeout.doctest.md` | 2.619 s | pass |
| 299 | `test/webapp/capture-resumable-sessions.doctest.md` | 2.617 s | pass |
| 300 | `test/cli/commands/session-huge-guard.doctest.md` | 2.589 s | pass |
| 301 | `test/dev/lib/audit-box.doctest.md` | 2.566 s | pass |
| 302 | `test/publish/submission.doctest.md` | 2.553 s | pass |
| 303 | `test/schemas/card-loaders.doctest.md` | 2.544 s | pass |
| 304 | `test/core/nav.doctest.md` | 2.544 s | pass |
| 305 | `test/webapp/ws-auth.doctest.md` | 2.511 s | pass |
| 306 | `test/core/capture/capture-wrapper.doctest.md` | 2.507 s | pass |
| 307 | `test/cli/lib/chat-routes.doctest.md` | 2.505 s | pass |
| 308 | `test/core/view-link-migration.doctest.md` | 2.488 s | pass |
| 309 | `test/core/procedure/procedure-validate-model.doctest.md` | 2.480 s | pass |
| 310 | `test/hub/child-output-log.doctest.md` | 2.460 s | pass |
| 311 | `test/shared/attach-path.doctest.md` | 2.433 s | pass |
| 312 | `test/shared/ref-path.doctest.md` | 2.421 s | pass |
| 313 | `test/core/commands/attachments-unignore.doctest.md` | 2.388 s | pass |
| 314 | `test/core/chat-session-history.doctest.md` | 2.367 s | pass |
| 315 | `test/core/chat/review/span.doctest.md` | 2.342 s | pass |
| 316 | `test/core/asset-manifest.doctest.md` | 2.334 s | pass |
| 317 | `test/core/chat-turn-buffer.doctest.md` | 2.328 s | pass |
| 318 | `test/webapp/auth-public-url-fallback.doctest.md` | 2.323 s | pass |
| 319 | `test/shared/model-ids.doctest.md` | 2.314 s | pass |
| 320 | `test/core/generate-docs.doctest.md` | 2.310 s | pass |
| 321 | `test/connectors/calendar-sync-decision.doctest.md` | 2.293 s | pass |
| 322 | `test/core/box-skills.doctest.md` | 2.287 s | pass |
| 323 | `test/publish/cloudflare-auth.doctest.md` | 2.287 s | pass |
| 324 | `test/core/chat-husk.doctest.md` | 2.267 s | pass |
| 325 | `test/core/commands/gemini-json-boundary.doctest.md` | 2.266 s | pass |
| 326 | `test/webapp/pairing-routes.test.ts` | 2.257 s | pass |
| 327 | `test/connector-response.doctest.md` | 2.215 s | pass |
| 328 | `test/core/chat-schedules.doctest.md` | 2.182 s | pass |
| 329 | `test/core/chat-card-activity.doctest.md` | 2.174 s | pass |
| 330 | `test/lib/mimetype.doctest.md` | 2.167 s | pass |
| 331 | `test/lib/filename.doctest.md` | 2.162 s | pass |
| 332 | `test/core/template-stock-hashes.doctest.md` | 2.160 s | pass |
| 333 | `test/connectors/google-oauth-state.doctest.md` | 2.137 s | pass |
| 334 | `test/core/finish-job.doctest.md` | 2.132 s | pass |
| 335 | `test/core/capture/write-cards-audio-format.doctest.md` | 2.108 s | pass |
| 336 | `test/frontend/capture-message.doctest.md` | 2.101 s | pass |
| 337 | `test/publish/manifest.doctest.md` | 2.092 s | pass |
| 338 | `test/webapp/login-throttle.doctest.md` | 2.084 s | pass |
| 339 | `test/hub/hub-http-error.doctest.md` | 2.077 s | pass |
| 340 | `test/core/box-defaults-landmark.doctest.md` | 2.070 s | pass |
| 341 | `test/core/retro/retro-walker.doctest.md` | 2.069 s | pass |
| 342 | `test/dev/lib/box-guard.doctest.md` | 2.065 s | pass |
| 343 | `test/connectors/calendar-utils.doctest.md` | 2.058 s | pass |
| 344 | `test/core/git-mv-nudge.doctest.md` | 2.055 s | pass |
| 345 | `test/core/landmark/landmark-nearest.doctest.md` | 2.042 s | pass |
| 346 | `test/core/box-defaults-todo-view.doctest.md` | 2.036 s | pass |
| 347 | `test/shared/todo-model.doctest.md` | 2.022 s | pass |
| 348 | `test/core/commands/attachments-gitignore.doctest.md` | 2.005 s | pass |
| 349 | `test/core/external-url-check.doctest.md` | 2.001 s | pass |
| 350 | `test/dev/lib/context-history.doctest.md` | 1.981 s | pass |
| 351 | `test/frontend/lib/place-label.doctest.md` | 1.974 s | pass |
| 352 | `test/frontend/chat-machine-finalize.doctest.md` | 1.973 s | zero tests |
| 353 | `test/lib/annex-pointer.doctest.md` | 1.973 s | pass |
| 354 | `test/core/chat/session/load-history.doctest.md` | 1.967 s | pass |
| 355 | `test/frontend/lib/structured-output-parsing.doctest.md` | 1.964 s | pass |
| 356 | `test/frontend/lib/speech-keywords.doctest.md` | 1.954 s | pass |
| 357 | `test/core/chat/review/state.doctest.md` | 1.952 s | pass |
| 358 | `test/frontend/voice-chip-face.doctest.md` | 1.951 s | zero tests |
| 359 | `test/frontend/lib/retention.doctest.md` | 1.947 s | pass |
| 360 | `test/result.doctest.md` | 1.946 s | pass |
| 361 | `test/connectors/google-auth-status.doctest.md` | 1.931 s | pass |
| 362 | `test/webapp/auth-hub-identity.doctest.md` | 1.929 s | pass |
| 363 | `test/core/browse-key.doctest.md` | 1.891 s | pass |
| 364 | `test/frontend/chat/processing-status-display.doctest.md` | 1.879 s | zero tests |
| 365 | `test/frontend/capture-upload-retry.doctest.md` | 1.873 s | zero tests |
| 366 | `test/publish/leak-scan.doctest.md` | 1.868 s | pass |
| 367 | `test/core/box-config.doctest.md` | 1.867 s | pass |
| 368 | `test/lib/is-record.doctest.md` | 1.860 s | pass |
| 369 | `test/core/intake.doctest.md` | 1.855 s | pass |
| 370 | `test/frontend/todo-view-card-logic.doctest.md` | 1.853 s | pass |
| 371 | `test/core/landmark/landmark-feature-seed.doctest.md` | 1.812 s | pass |
| 372 | `test/core/retro/retro-scan.doctest.md` | 1.811 s | pass |
| 373 | `test/dev/lib/context-usage.doctest.md` | 1.805 s | pass |
| 374 | `test/invariant.doctest.md` | 1.803 s | pass |
| 375 | `test/frontend/turn-message-stream.doctest.md` | 1.800 s | zero tests |
| 376 | `test/frontend/lib/patmatch.doctest.md` | 1.791 s | pass |
| 377 | `test/private-link-check.doctest.md` | 1.767 s | pass |
| 378 | `test/cli/lib/box-layout-spec.doctest.md` | 1.764 s | pass |
| 379 | `test/frontend/voice-intent.doctest.md` | 1.761 s | pass |
| 380 | `test/lib/atomic-write.doctest.md` | 1.743 s | pass |
| 381 | `test/frontend/lib/view-bindings.doctest.md` | 1.741 s | zero tests |
| 382 | `test/frontend/lib/speech-parsing.doctest.md` | 1.737 s | pass |
| 383 | `test/frontend/lib/video-url.doctest.md` | 1.734 s | pass |
| 384 | `test/dev/lib/duplication.doctest.md` | 1.733 s | pass |
| 385 | `test/core/event-bus.doctest.md` | 1.730 s | pass |
| 386 | `test/lib/error-guards.doctest.md` | 1.726 s | pass |
| 387 | `test/core/commands/describe-images-helpers.doctest.md` | 1.725 s | pass |
| 388 | `test/print.doctest.md` | 1.722 s | pass |
| 389 | `test/lib/multipart.doctest.md` | 1.720 s | pass |
| 390 | `test/frontend/lib/view-url.doctest.md` | 1.718 s | pass |
| 391 | `test/core/voxtral-transcription.doctest.md` | 1.713 s | pass |
| 392 | `test/dev/csp-digest.doctest.md` | 1.713 s | pass |
| 393 | `test/lib/natural-sort.doctest.md` | 1.710 s | pass |
| 394 | `test/webapp/routes/proxy-image.doctest.md` | 1.701 s | pass |
| 395 | `test/frontend/lib/audio-cache.doctest.md` | 1.700 s | pass |
| 396 | `test/frontend/chat/reconnect-refresh-gate.doctest.md` | 1.698 s | pass |
| 397 | `test/frontend/lib/wav-encode.doctest.md` | 1.698 s | pass |
| 398 | `test/frontend/lib/nav-menu-entries.doctest.md` | 1.692 s | pass |
| 399 | `test/frontend/emission-assemble.doctest.md` | 1.680 s | pass |
| 400 | `test/frontend/audio-playback-errors.doctest.md` | 1.676 s | zero tests |
| 401 | `test/frontend/speech-playback-machine.doctest.md` | 1.671 s | zero tests |
| 402 | `test/core/chat-features.doctest.md` | 1.666 s | pass |
| 403 | `test/frontend/lib/selection-serialize.doctest.md` | 1.666 s | pass |
| 404 | `test/frontend/lib/selection-position.doctest.md` | 1.660 s | pass |
| 405 | `test/webapp/base-server-url.doctest.md` | 1.648 s | pass |
| 406 | `test/frontend/lib/file-version.doctest.md` | 1.636 s | pass |
| 407 | `test/frontend/lightbox-gesture-math.doctest.md` | 1.628 s | pass |
| 408 | `test/frontend/lib/location-share.doctest.md` | 1.621 s | zero tests |
| 409 | `test/frontend/components/chat/InteractiveChat-recovery.doctest.md` | 1.617 s | pass |
| 410 | `test/frontend/upload-message.doctest.md` | 1.617 s | pass |
| 411 | `test/frontend/native-composer-command.doctest.md` | 1.614 s | pass |
| 412 | `test/hub/hub-health.doctest.md` | 1.613 s | pass |
| 413 | `test/frontend/commit-detail-diff-pointers.doctest.md` | 1.607 s | pass |
| 414 | `test/frontend/lib/fetch-coalescer.doctest.md` | 1.598 s | pass |
| 415 | `test/cli/lib/paths.doctest.md` | 1.594 s | pass |
| 416 | `test/frontend/native-narration-bridge.doctest.md` | 1.582 s | zero tests |
| 417 | `test/core/engine-version.doctest.md` | 1.582 s | pass |
| 418 | `test/frontend/chat-target.doctest.md` | 1.575 s | pass |
| 419 | `test/frontend/context-chip-label.doctest.md` | 1.570 s | pass |
| 420 | `test/frontend/upload-queue.doctest.md` | 1.566 s | pass |
| 421 | `test/connectors/google-calendar-state.doctest.md` | 1.560 s | pass |
| 422 | `test/frontend/speech-progress-indicators.doctest.md` | 1.556 s | pass |
| 423 | `test/frontend/emission-persist.doctest.md` | 1.556 s | pass |
| 424 | `test/prompt-fence.doctest.md` | 1.554 s | pass |
| 425 | `test/frontend/lib/deferred-resync.doctest.md` | 1.553 s | pass |
| 426 | `test/core/commands/scan-import-helpers.doctest.md` | 1.551 s | pass |
| 427 | `test/frontend/lib/figure-params.doctest.md` | 1.548 s | pass |
| 428 | `test/frontend/lib/chunked-recorder.doctest.md` | 1.547 s | pass |
| 429 | `test/core/capture/audio-concat.doctest.md` | 1.535 s | pass |
| 430 | `test/frontend/chat-scroll-reconcile.doctest.md` | 1.530 s | pass |
| 431 | `test/core/extfile-sync.doctest.md` | 1.524 s | pass |
| 432 | `test/frontend/screenshot-request.doctest.md` | 1.512 s | pass |
| 433 | `test/frontend/lib/parse-tags.doctest.md` | 1.506 s | pass |
| 434 | `test/core/loader-registry.doctest.md` | 1.506 s | pass |
| 435 | `test/core/compile-exposition-rules.doctest.md` | 1.503 s | pass |
| 436 | `test/frontend/session-list-grouping.doctest.md` | 1.498 s | pass |
| 437 | `test/frontend/lib/stream-entry.doctest.md` | 1.488 s | pass |
| 438 | `test/core/commands/upload-helpers.doctest.md` | 1.486 s | pass |
| 439 | `test/frontend/chat-session-transition.doctest.md` | 1.485 s | pass |
| 440 | `test/frontend/reconcile-pending.doctest.md` | 1.471 s | pass |
| 441 | `test/frontend/native-emission-bridge.doctest.md` | 1.465 s | pass |
| 442 | `test/frontend/native-location-bridge.doctest.md` | 1.455 s | zero tests |
| 443 | `test/frontend/history-blob-paths.doctest.md` | 1.454 s | pass |
| 444 | `test/core/body-refs.doctest.md` | 1.449 s | pass |
| 445 | `test/frontend/lib/error-guards.doctest.md` | 1.443 s | pass |
| 446 | `test/shared/view-params.doctest.md` | 1.434 s | pass |
| 447 | `test/frontend/emission-editor.doctest.md` | 1.419 s | pass |
| 448 | `test/frontend/native-post.doctest.md` | 1.415 s | pass |
| 449 | `test/core/commands/scan-import-cards.doctest.md` | 1.400 s | pass |
| 450 | `test/frontend/composer-machine.doctest.md` | 1.394 s | pass |
| 451 | `test/frontend/photo-batch-threshold.doctest.md` | 1.390 s | pass |
| 452 | `test/frontend/native-box-switching.doctest.md` | 1.386 s | pass |
| 453 | `test/core/chat/session-id-file.doctest.md` | 1.383 s | pass |
| 454 | `test/frontend/lightbox-gesture-reducer.doctest.md` | 1.376 s | pass |
| 455 | `test/core/markdoc/emit-nodes.doctest.md` | 1.361 s | pass |
| 456 | `test/core/install-template-file.doctest.md` | 1.354 s | pass |
| 457 | `test/frontend/toast-store.doctest.md` | 1.349 s | pass |
| 458 | `test/env.doctest.md` | 1.331 s | pass |
| 459 | `test/doc-link-repair.doctest.md` | 1.291 s | pass |
| 460 | `test/frontend/screenshot-capture.doctest.md` | 1.285 s | pass |
| 461 | `test/frontend/receipts.doctest.md` | 1.278 s | pass |
| 462 | `test/frontend/native-speech-playback-bridge.doctest.md` | 1.253 s | zero tests |
| 463 | `test/frontend/speech-message.doctest.md` | 1.247 s | pass |
| 464 | `test/core/pending-browser-request.doctest.md` | 1.220 s | pass |
| 465 | `test/dev/lib/report.doctest.md` | 1.216 s | pass |
| 466 | `test/cli/lib/format.doctest.md` | 1.213 s | pass |
| 467 | `test/frontend/frontend-api.doctest.md` | 1.189 s | zero tests |
| 468 | `test/core/push-subscriptions-store.doctest.md` | 1.188 s | pass |
| 469 | `test/core/external-ref.doctest.md` | 1.161 s | pass |
| 470 | `test/core/chat-session-lifecycle.doctest.md` | 1.160 s | pass |
| 471 | `test/connectors/drive-sheet-data.doctest.md` | 1.154 s | pass |
| 472 | `test/connectors/drive-types.doctest.md` | 1.151 s | pass |
| 473 | `test/dev/lib/session-report.doctest.md` | 1.123 s | pass |
| 474 | `test/core/claude-md-lint.doctest.md` | 1.116 s | pass |
| 475 | `test/core/commands/scan-guide-context.doctest.md` | 1.036 s | pass |
| 476 | `test/frontend/lib/dictation-draft.doctest.md` | 1.028 s | pass |
| 477 | `test/core/chat-response-extraction.doctest.md` | 1.028 s | pass |
| 478 | `test/core/procedure/procedure-run-status.doctest.md` | 0.921 s | pass |
| 479 | `test/core/geo.doctest.md` | 0.901 s | pass |
| 480 | `test/core/external-url-fetch.doctest.md` | 0.828 s | pass |

</details>
