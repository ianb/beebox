# What makes a test valuable here: evidence from the suite's own history

Written 2026-10-23 for the finish step proposed in
[finish-reviews-new-tests-for-long-term-value](../../issues/docs-and-chores/2026-10-21-finish-reviews-new-tests-for-long-term-value.md).
A dated snapshot per [research/AGENTS.md](../AGENTS.md). Nothing here changes
a test or the finish skill; it proposes criteria and says what evidence each
rests on.

| note | what it holds |
|---|---|
| [failure-history.md](failure-history.md) | 959 full runs and 1,401 selected runs from the test ledger; every `full-suite-red` and flake issue classified by cause |
| [git-churn.md](git-churn.md) | Per-test history for all 1,332 test files; 40 expected-value edits and 30 fix commits read and classified; every deletion |
| [reading-core.md](reading-core.md) | 18 files read from `test/core`, `test/shared`, `test/lib`, `test/schemas` (about 290 checks) |
| [reading-web.md](reading-web.md) | 18 files from `test/webapp`, `src/frontend`, `test/hub`, `test/cli` (about 330 checks) |
| [reading-tooling.md](reading-tooling.md) | 18 files from connectors, services, `bin/`, `schedules/`, `workstreams-app`, `tap-check` (about 190 example groups) |
| `data/`, `scripts/` | The per-file tables and the scripts that produced them |

## 1. Method and data

Three kinds of evidence, each with its own reach.

**Run history.** The test ledger in `.git/` records every suite run on this
machine from 2026-08-30 to 2026-10-23: 959 full runs (827 of them the hourly
schedule, as ordinary and careful tier pairs) and 1,401 selected runs
(developer iteration through `pnpm test:changed`). Each record lists the
files that failed. The 31 closed `full-suite-red` issues, one open one, and
37 flake issues say what each failure turned out to be. Limits: the ledger
does not record whether a selected-run failure was a caught regression or a
test under construction; the schedule files nothing for a run with more than
20 failing files; files renamed in the 2026-09-27 layout move appear twice.

**Git history.** For every one of the 1,332 `*.test.ts` files: creation
commit, whether it came with source, later commits split into mechanical
sweeps (85 commits: the doctest conversion, the layout moves, the rename
sweeps) and real edits, and whether each real edit also touched source. On
top of that, two read samples: 40 random commits that changed an expected
value, and 30 random fix commits that touched source and tests, each diff
read and classified. Limits: worktree branches merge with full history, so
iteration is visible at commit granularity, but a test that went red and was
fixed before a commit leaves no trace. The in-development catch rate is
therefore inferred, never measured.

**Reading.** 54 test files, stratified by area, age (2026-01 to 2026-10-22)
and size (30 to 782 lines), about 810 checks in about 610 example groups.
Each group was classified on two axes:

- W, what it taught when written: W1 forced a design boundary; W2 pinned a
  bug that occurred; W3 defined a contract from a plan; W4 exploration that
  found nothing; W5 no reason visible.
- R, what it teaches on each later run: R1 guards a branch a plausible edit
  reverts; R2 guards a cross-system contract (wire, on-disk, CLI output
  another tool parses, exports); R3 guards a trust or containment boundary;
  R4 guards migration or on-disk compatibility; R5 restates straight-line
  code; R6 second proof of a proved claim; R7 tests a fake, the framework, or
  a type; R8 pins wording, ordering or markup that is a choice.

Plus: does the comment say why the expected value is right, and would the
check pass against a no-op. Three agents read, one adjudicated. The
classifications are one reader's judgment per file; counts are approximate
and are reported as shares.

Suite size today: 1,332 test files, 5,568 `test()` blocks, 11,255
`t.check` calls, 187k test lines against 317k source lines in `beebox/`. A
full run is about 6,000 file-seconds; the median file takes 2.2 s, the
slowest 50 files take 36% of the time.

## 2. What the history shows

### 2.1 On main, the suite rarely catches a regression and often reports a stale snapshot

Over 959 full runs, 384 were red. 621 files failed at least once, but 389 of
those failed only inside the ten mass-red runs that the schedule itself
classes as environment. 75 files ever failed in a run with one to three
failures. 1,326 files (68%) never failed.

The 19 distinct red-main episodes with an issue resolve as:

| cause | episodes | files |
|---|---|---|
| real regression caught | 4 | `ui-scan/annotations` (duplicate id in two branches of `DriveSection.tsx`), `chat.hq-preferences` (a lost update in the reserved-feature handoff, reproduced 20/20; twice), `capture/resume` (a referenced interval kept Node alive) |
| code changed on purpose, test's expectation stale | 9 | `release-manifest`, `file-watcher` (twice), `one-root-migration`, the theme open-set trio, `hub-e2e` fixture, `box-inventory` counts, `chat.send-fast-ack`, `ui-scan.annotations` (open now) |
| load, environment, unexplained | 6 | four of them blamed on an innocent landing before the slowdown gate existed |
| test-harness bug | 1 | a preload changed git's default branch for every helper |

The long red episodes in the ledger without an issue (release-manifest 21
hours, hub-e2e 15, annotations 13 and 11, launch-session 10, file-watcher 84)
all trace to a `test: expects ...` commit: the same stale-snapshot shape. The
common form is an exact snapshot of a generated set: a directory listing, a
package `files` list, inventory counts, an id table, a full HTML string.

Three product regressions in 54 days is the schedule's whole catch. Each was
in a test that exercises timing or process state, and two of the three files
are also among the most often stale or flaky. The flake issues add four
product bugs found by investigating a flake (`child-output-log`,
`chat-default-route`, `git-lock`, the chat shutdown wait), each through
investigation and never through the red run itself.

### 2.2 In development, tests fail constantly, and that is where the catch is

1,401 selected runs; 350 red. 94% of the failing records are `attached`:
the selection graph pointed at the file because of the developer's own
change. 344 files (17% of all) failed only in selected runs and never on
main. The files that fail most during iteration are fixture snapshots
(`box-inventory` 29 times, `template-stock-hashes` 15, `landmark-schema` 13,
`file-watcher` 32) that almost never fail on main. The ledger cannot say
whether the developer then fixed the code or the test. Git says something:
of 40 expected-value edits read, 58% record an intended behavior change, 15%
found that the old pinned value was the bug, 15% were refactor churn, 12%
hardened a flaky test.

### 2.3 Tests track behavior; test-only maintenance is rare; sweeps are the main cost

| per test file (n = 1,332) | share |
|---|---|
| never edited after creation, sweeps excluded | 24.6% (37% under 30 days old, 7% over 180) |
| at least one later commit that also touched source | 74% |
| at least one later commit touching the same-basename source file | 53% |
| any test-only edit | 13% |
| three or more test-only edits | 1.2% |
| mean mechanical rewrites per file | 5.97 |
| mean test-only edits per file | 0.19 |

A test here is six times more likely to be rewritten by a sweep than edited
on its own. "Never changed" is an age effect, not a property of the test.

### 2.4 Fix commits add replays; tests leave only when their subject leaves

Of 1,010 conventional `fix:` commits, 46% touch source and tests, 44% source
only (frontend and lifecycle code with no unit seam, lint fallout, iOS). When
a fix touches tests, 22 of 24 sampled add a check that names the symptom or
issue. Deletions outside the two sweeps: 159 files in 64 commits, every
sampled one a test following its feature or subsystem out of the codebase.
No live test has ever been removed for being wrong or annoying except by the
2026-10-08 sweep.

### 2.5 What the tests themselves look like

Across the 54 files:

| axis | share | where it concentrates |
|---|---|---|
| W3 plan-defined contract | 70 to 80% | the default; most cite a plan or track |
| W2 bug pin | 12 to 24% | files with an incident trail (`migration-sweep`, `full-suite/run`, `test-ledger`, `claude-chat`, hub auth) |
| W1 forced a boundary | under 5% as examples | present as file structure: a pure `*-lib.ts` and an I/O shell land in one commit (`test-select-lib`, `test-ledger-lib`, `full-suite/lib`, `RouterAuthDeps`, `openAccess`) |
| W4 exploration kept | under 2% | a few unlabelled lists (`relative-time` hours/days, activity-wording "everything else") |
| R1 branch guard | about 50% | everywhere |
| R3 trust boundary | 9 to 40% | auth, pairing, containment, hub, secrets, blocklist: 26 of 26 in `workstreams-app` router auth |
| R2 cross-system contract | about 10% | wire shapes the iOS app reads, card formats on disk, TAP and git formats, package exports |
| R6 second proof | 5 to 23% | mostly across files and layers, which a per-file review cannot see |
| R8 pins a choice | about 10% | third-party wording in messages (zod, Markdoc), log lines, `nextStep` prose, list order; it rides on otherwise good checks |
| R5 restates code | 4 to 11% | small, old "convention documentation" files (`result`, `natural-sort`, `geo`, `engine-version`) |
| R7 tests fake, framework, type | 3 to 5% | `.success` booleans, `t.check("ok","ok")` after a validator |
| passes against a no-op | about 6% | the same idioms |
| comment says why the value is right | 65 to 75% | newer and W2 examples near 100%; 2026-03 files lowest |

W2 and R1 co-occur almost perfectly, and W2 examples carry the best
comments: "restarts would pin the hub red forever", "an earlier version
cleared the entry in the effect cleanup (e22c56ead)", "2026-09-11: load1 8
read quiet against a bar of 12 while swap thrashed". File size does not
predict R5 or R6 share; kind does. The two largest core files are mostly R1
because they grew one example per incident.

## 3. Categories of test value, with examples

Each category says what the test taught when written and what it still
teaches on each run. The two differ, and the finish step should ask both.

**A. The bug replay.** Written: it failed before the fix and passed after,
so it proved the fix. Each run: it guards the one edit that would reintroduce
the symptom, and its comment tells the next reader what the symptom was.
`test/hub/health.test.ts`, "restarts 47, consecutiveFailures 0 is not
broken": the one check that fails if someone consults `restarts`.
`src/frontend/test/components/app-bar-chrome.place-owners.test.ts`: three
observations in one array, a named commit, a stated reason for the harness.
`test/core/migration-repair.malformed-question.test.ts` (2026-10-22): four
checks, all W2, each a whole-value object with a why-comment. None of these
has failed since; that is the expected life of a replay.

**B. The boundary table.** Written: it enumerated who may reach what, and
the enumeration is the security claim. Each run: it fails closed on any
widening. `workstreams-app/test/router/server/auth.test.ts`: every row of
the plan's failure-modes table, with spy flags proving check order.
`test/webapp/auth.required.test.ts`, "every batched tRPC procedure must be
whitelisted": the fix for a substring match that let a diag-key holder read
past two endpoints. `test/lib/box-containment.test.ts`, "prefix collision"
`/box-evil/secret`. Repetition across entry points is deliberate here
(`mounts.test.ts` refuses the same path from three code paths).

**C. The contract another system reads.** Written: it stated the shape at
the moment both sides were built. Each run: it catches drift that no
in-process test can. `test/hub/server.auth.test.ts`, the
`x-bbx-authenticated-email` header the box trusts and the `/api/boxes`
payload the iOS app parses; `test/scripts/release.manifest.test.ts`, every
package export covered by `files` ("ERR_MODULE_NOT_FOUND in a stranger's
box"); `bin/test-select.test.ts`, the summary line the finish agent parses;
card text on disk in `test/schemas/question.test.ts`.

**D. The branch a later edit reverts.** Written: it defined the rule while
the code was being shaped. Each run: when the rule changes on purpose, the
test is what makes the change visible in the diff. This is half the suite.
Its run-time value is documentation and review, not catching: 58% of
expected-value edits are this shape. It earns its place when the comment
names the edit that would break it (`bin/test-select.test.ts`, "a change
nothing imports selects nothing, there is no full-suite fallback") and loses
it when the "branch" is a lookup table or a one-line comparison
(`engine-version` third comparison, `geo` zero distance).

**E. The forced seam.** Written: the whole value. The test exists so that a
pure function exists; the lib and its test land in one commit. Each run: it
runs the pure half in milliseconds. `bin/test-select-lib.ts` ("the pure
half"), `schedules/full-suite/lib.ts`, `isBoxBroken` extracted from the
supervisor. Where the seam was not forced, the tests pay every run:
`BBX_*` env juggling in teardowns, a `Reflect.set` on
`ChatSession.prototype.startRun`, `console.log` interception.

**F. The snapshot of a generated set.** Written: cheap, and it documented
the set. Each run: it fails on every deliberate scaffold change and on
almost no bug. `file-watcher` sat red 84 hours over two episodes because
the skeleton gained `_config/interface` and then `_config/feedback`; the
fix derived the listing from a fresh box. `release-manifest` was red 42
hours over three episodes until it stopped snapshotting `files`.
`ui-scan.annotations` caught one real duplicate id and was stale three
times. This is the category with the clearest cost and the clearest
rewrite: derive, or narrow to the claim.

**G. The convention demonstration.** Written: it documented how to use
`ok`/`err`, `natural-sort`, haversine. Each run: nothing; a no-op or any
implementation passes. `test/shared/result.test.ts` tests a local fixture
and union narrowing the compiler enforces; `geo` "zero for identical
points". These belong in a doc comment.

**H. The weak form.** `t.check("ok","ok")` after a validator (six of ten
checks in `services/google-drive/schemas.test.ts`), `.success` booleans
(15 in `question.test.ts`), `=> undefined` on a void guard, `.length`
sums. The claim is often real; the assertion cannot distinguish "accepted"
from "not validated". A rewrite, not a removal.

## 4. Proposed criteria

Stated as the question the analyzer asks of each new or changed example.
Confidence is about the evidence, not about the wording.

### Keep

**K1. It names a failure that happened and fails without the fix.** The
commit, the issue path, or the comment says what broke. Confidence high:
fix commits add such replays 22 of 24 times; these examples have the best
why-comments; expected-value edits that found the old value wrong (15%) are
this shape in reverse. The author's session knows whether it failed first;
the finish step should ask and record the answer. A replay that never fails
again is the normal case, and never-failed is no mark against it.

**K2. It guards a trust, privacy, or containment boundary.** Who may reach
what, what may leave the box, what a token can still do. Confidence high:
every sample agrees, and these files have the highest why-coverage; the
earlier keep list stands. Enumeration across entry points is deliberate
here and is not R6.

**K3. It states a contract another system reads.** Wire shape, on-disk card
format, CLI output or TAP another tool parses, package exports, migration
bookkeeping. Confidence high for the contract, medium for the form: the
contract tests that went stale were snapshots (F); the rewrite that fixed
`release.manifest` kept the claim and dropped the snapshot.

**K4. It guards a branch and the comment names the edit that would break
it.** Confidence medium. This is half the suite and its run-time value is
review visibility: the diff shows the behavior change. The earlier
hypothesis that straight-line, never-changed, never-failed code can be
dropped (C3) is refuted as a criterion: never-changed is age, never-failed
is 68% of the suite, and neither predicts the R category. The discriminator
is whether an edit that reverts the branch is plausible, which is judgment.

### Rewrite or merge

**M1. Snapshot of a generated set.** Directory listings, package file lists,
inventory counts, id tables, full HTML, multi-line logs. Derive the set from
the system or narrow to the rows the claim is about. Confidence high: 9 of
19 red-main episodes and over 150 red hours, against one caught regression.
This is the main new criterion the earlier sweeps did not have.

**M2. Pinned wording that is a choice.** Third-party error text, log lines,
`nextStep` prose, list order, class names. Narrow the check to the field
that carries the rule; keep the prose only where the words are the feature
(activity-wording) and say so. Confidence medium: about 10% of checks, and
they fail on upgrades and copy edits; no caught regression traces to one.

**M3. Second proof across files or layers.** The same inputs through a
wrapper and its callee (`box-containment` re-running `ref-path`), a
registry rule re-proved through HTTP, a template byte-identical in two
files. Keep the copy in the code's home. Confidence medium-high; this
supports the earlier C2, with the finding that most R6 is cross-file, so
the analyzer must look at siblings, not only the diff.

**M4. Weak form with a real claim.** The `"ok"` idiom, `.success`, `.length`,
`existsSync`, `=> undefined`. Rewrite to the whole value. Confidence high
that these are weak (about 6% pass a no-op); low that removing them helps,
since the claim underneath is usually real.

### Remove

**X1. Restates straight-line code or a convention.** A lookup, a one-line
comparison, a constructor, a local fixture. Confidence high but low yield:
4 to 11% of checks, concentrated in small old files; the earlier C1 holds.

**X2. Tests the framework, a fake, or a type.** Confidence high, yield
under 5%; C4 holds. No sampled test is a test *of* a fake since the 10-08
sweep; the residue is zod and Intl behavior.

**X3. Exploration that found nothing.** A row with no stated reason in a
table of inputs. Confidence medium, yield low: agents here write to a plan
or an incident, and the 2026-10-11 rule already asks for the reason. The
analyzer should ask the author which rows failed.

**C5 (mirrors a type)** is refuted as a yield: it appears only as `.success`
booleans, which M4 covers.

### What a new test cannot show

A new test has no failure history, and this note says history would not
help much anyway: 68% of files never failed, and the ones that did were
mostly stale snapshots. The decision for a new test rests on K1 to K4 and
M1 to M4, all of which can be read from the test, its comment, the code
under test, and the author's answer to "did it fail first".

### Revisions after application (2026-10-23)

[application/README.md](application/README.md) applied these criteria to
60 files (1,338 checks): 83% kept, 8% rewritten, 3% narrowed, 1% merged,
4% removed. The control tranche of unflagged files had the same 4%
removal rate, so the suite-wide removal is about 500 checks, and the
earlier 800 to 1,700 estimate was high. The criteria change as follows.

- **M4.** The weak form is a lossy projection on the left of the check
  (`.success`, `.ok`, `.pass`, `.length`, `.code`, `.status`, `.includes`,
  `.matches`, `some(...)`, a `join` or template of fields), not a boolean
  or null on the right: two thirds of the right-hand flags were functions
  whose return is the boolean. A rewrite that would make the whole value
  a generated set (18 paths, a long brief) stays narrowed and says so.
- **M1.** Length is not the signal. The forms found: a helper's output
  pinned as a literal, an exported constant hand-copied, and one whole
  object repeated across checks for one claim.
- **M2.** Whether the text is ours or a library's decides the edit, and
  the zod vocabulary does not tell: 44 of 50 flagged strings were our
  own messages, a TAP diff the package exists to produce, or an enum
  value. Grepping a fragment of the literal in `src/` separates the four
  real zod messages from most of ours but fails on templated messages, so
  it raises precision from 10% to about 30%, no more.
- **M3.** Add in-file duplicates (consecutive identical checks, the same
  route proved twice in one test, one list at two layers of one file).
  Add the exception that agreement between two layers can be the claim.
  Byte-identical literals across files were fixture coincidences in 8 of
  12 cases; the real duplicates had different literals for the same
  function and inputs.
- **X1.** Add the volume form: a catalog or registry mirrored row by row
  into expected values (`THEME_CATALOG`, `FEATURE_LIST`). It supplied 28
  of the 39 X1 checks and is the one removal that scales.
- **Negative timing claims** ("has not finished after 100 ms") have no
  whole value and no disposition; they are flake risk and stay as K with
  a note.
- **X2 and X3** did not occur in 1,338 checks. The 10-08 sweep took them;
  they are not worth a signal in the recurring sweep.

## 5. Mechanical versus judgment

A script can produce, per in-scope example:

- The enumeration itself: added files, added `test()` blocks, changed
  `t.check` right-hand sides, from the diff against main. 93% of tests have
  a lead-in comment and 7% of checks have one on the preceding line, so
  "has a comment" is a weak but cheap flag.
- K1 signals: an issue path, a date, a commit hash, or "before", "used to",
  "regression" in the comment or the commit message. Whether the test fails
  with the branch's source reverted: check out `main`'s version of the
  changed source files and run the new tests. This is the strongest
  mechanical check available and is scriptable from `bin/test-select`'s
  graph.
- K2 signals: the test imports or lives under auth, pairing, secrets,
  containment, hub, scan-token, blocklist paths.
- M1 signals: an expected value that is an array or `str` block longer than
  N lines, or built from `readdir`, `package.json`, or rendered HTML.
- M2 signals: expected strings matching zod or Markdoc message patterns;
  `console.warn` or log-line arrays as expected values.
- M3 signals: an expected literal byte-identical to one in another test
  file; a new test file whose imports are a subset of a sibling's.
- M4 signals: `t.check(x, true|false)`, `.success`, `.length`, `.includes`,
  `existsSync`, `t.check("ok", "ok")`, `=> undefined` on a void function.
- Flake risk: `setTimeout`, `sleep`, real `Date.now()` without a fixed
  clock; a spawned child; a listening server. The 12% hardening edits all
  trace to these.
- Cost: the ledger's per-file duration for the file, if it ran before.

The application pass measured these flags: right about files, wrong about
checks. Per flagged check, M4 was right or partly right 35% of the time,
M1 21%, M2 24%, M3 19%; per file, flagged files yielded edits at 9% to 24%
of checks against 6% in unflagged files. The sweep should rank files by
flag density and hand a reader the whole file, with the per-check flags as
a reading aid. Details and the better signals per flag are in
[application/README.md](application/README.md).

Judgment is needed for:

- K4: whether an edit that reverts the branch is plausible, and whether the
  comment names it.
- Whether a repetition is a boundary enumeration (keep) or a second proof
  (merge). The file header usually says.
- Whether pinned wording is the feature or a choice.
- Whether a W3 example from a plan is a rule or a straight-line value.
- The author's intent: whether the test failed first, which rows of a table
  failed, why the harness is shaped as it is. The developing session has
  this and the finish agent does not, which supports the boxholder's
  decision to run the analysis in the developing session.

## 6. Worked application: three recent landings

Run by hand with the criteria above, as the finish step would.

### gmail-404-stuck (merge 32ac28309, one commit)

One test added to `test/connectors/gmail/tracking.rules-and-discovery.test.ts`,
"History pages are read in one sync until the ref limit, then resume at
the next page", plus one expected value changed (`requestedMaxResults` 100
to 500).

- K1: the comment names "the 2026-10-22 Gmail stall's backlog"; the commit
  says a sync read one page of 100. Fails against main's `discovery.ts`
  (page size and the page loop both changed). Keep.
- The edited value is a class (a) edit: the new contract, stated in the
  commit. Keep.
- M1 risk: the expected `refs` arrays are generated by a helper from a
  rule, not pasted. Fine.

Disposition: keep both. The commit for the step would say so and cite the
stall.

### issue-audit (merge 9c4aedff6)

One test added to `test/core/docs-refresh.test.ts`, "A changed box-local
schema makes the docs stale".

- K1: the commit "Docs refresh: a changed box-local schema makes generated
  docs stale" is a fix; the comment says what goes wrong without it ("the
  rules keep describing the old fields"). Fails against main if the cache
  key ignored `src/schemas`. Keep.
- Flake risk flag: it bumps mtime with `utimes` sixty seconds ahead rather
  than relying on a real clock. That is the right form.

Disposition: keep.

### risky-merge-review (merge 9ca9bfac5, 19 commits, 24 test files)

A review branch that fixed findings; a fuller case. Six of its tests:

- `test/webapp/routes/scan-upload/scan-auth.test.ts`, "a member's scan
  token stops working when the member is removed". K2 and K1 (the commit
  names the hole). Keep. Cost flag: 33.9 s in its last ledger run, among the slowest
  files in the suite, because it builds a git box and a server; the
  analyzer should note the cost but not remove on it.
- `test/core/secrets/resolve.guarded-store.test.ts`. K1 (a box agent
  shelling to `bbx` under `TAP` reached a throwing guard) and K2. The last
  check pins two warning strings by prefix: M2, narrow to the two kinds of
  warning. Keep, with that narrowing suggested.
- `test/core/migration-sweep.real-commit-lint.test.ts`. K1 ("2026-10-20: a
  repair question quoting a machine path failed to commit on production,
  and no test had run the real lint") and K3 (the box's own hook). The
  second test, "a clean card commits through the real hook", is the
  positive control that makes the first non-vacuous. Keep both.
- `test/webapp/trpc/routers/health/checks/plugins/stubs.test.ts` and
  `.../core.test.ts`, both "an unreadable file does not stop the run". Two
  dangling-symlink cases across two files; core's comment already says
  stubs covers the stub case. M3 candidate: keep the stubs one and core's
  "a throw inside the plugin checks is one failing row", which is a
  different claim; the dangling-symlink case in core is a second proof.
- `test/hub/server.auth.test.ts`, the webhook passthrough removed. K2; the
  edited expected value records a contract change (302 instead of 200).
  The added raw-upgrade check for `/webhook/.../ws` repeats the preceding
  unauthenticated-upgrade check with a different path: deliberate boundary
  enumeration under K2, keep.

Disposition: keep all, one merge (the duplicated dangling-symlink case),
one narrowing (the warning prefixes). The dedicated commit would list the
24 files with these dispositions and the reasons above.

## 7. What the earlier work got right and wrong

- The 2026-10-08 criteria C1, C2 and C4 are supported; C3 and C5 are
  refuted, as that issue's own 64-file sample found.
- The keep list (trust, migrations, external input, cross-system contracts,
  files that failed on their own) is supported, with one correction: "failed
  on its own" is mostly the stale-snapshot shape and is a rewrite signal,
  not a keep signal by itself.
- Never-failed is context, as the volume issue said; this note adds that
  never-changed is context too, and both are age.
- The finish issue's candidate "it would pass with the code deleted" is
  supported at about 6% of checks, almost all in the weak idioms, which
  argues for rewriting rather than removing them.
- The expected-value rule of 2026-10-11 is working: the newest tests in
  every sample have a why-comment on every check and are all K1 or K4.
- One thing none of the earlier work named: the cost of the suite on main
  is the stale snapshot, and the value on main is three catches in 54 days,
  all in timing or process-state tests. The value of the rest of the suite
  is paid out during development, in selected runs, and in review diffs.
  Criteria for a new test should weigh that, which is what K4 and M1 do.
