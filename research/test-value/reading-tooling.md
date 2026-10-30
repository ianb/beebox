# Test-value evidence: 18-file stratified sample

Worktree: `beebox-worktrees/test-value-research`, read 2026-10-22. Ages are
the first commit touching a file of that basename (`--follow` stops at the
2026-09-27 layout move and the 2026-10-18 `.doctest.md` conversion).

Axes used per example or group of near-identical examples:

- W (when written): W1 forced a boundary/injectable or pure; W2 pinned a bug that happened; W3 defined a contract the plan/spec said; W4 exploration that found nothing; W5 unclear.
- R (each later run): R1 guards a branch a plausible edit breaks; R2 cross-system contract (wire/API/file/CLI output); R3 trust/privacy/security; R4 migration/on-disk compat; R5 restates straight-line code; R6 second proof of a proved claim; R7 tests a fake/framework/type; R8 pins wording/ordering that is a choice.
- "why" = does a comment say why the expected value is right. "weak" = would still pass against a no-op or the obvious wrong implementation.

Docs baseline (`beebox/docs/testing.md`, `beebox/docs/testing/check.md`): tests exist for (1) forcing decomposition, (2) documentation, (3) regression anchors; a test that passes with the code deleted is a defect, as is a second test of a proved claim; keep only the explored inputs that failed, with the reason the expected value is right. `.claude/rules/tests.md` bans `t.equal/t.same/t.ok` in beebox. Note the bin/, schedules/, workstreams-app router tests predate or sit outside that rule and use `node:assert`.

---

## 1. beebox/test/connectors/google-drive/mounts.test.ts

782 lines; first seen 2026-08-21 (largest connector test); 12 `test()`, 49 checks (`t.check`/`checkText`/`checkThrows`).

| group | W | R | why | weak |
|---|---|---|---|---|
| mount writes card + mirrors (result, card listing, card text, pointer text) | W3 (plan: mount is card-in-directory) | R2 (card format on disk) + R1 | yes ("A mount is not a promise for later") | no |
| second mount of same folder / second folder into same dir refused | W3 | R1 (dropping the claim check) | yes ("two cards for one Drive ID are two working copies") | no |
| mount refuses non-folder; nothing left behind; empty input never reaches Drive | W3 | R1 | yes | no |
| link fills extension, `origin: manual`, folder target ok, no double-link | W3 | R2 + R1 | yes ("origin: manual separates a pointer someone asked for from one a mirror emitted") | no |
| unmount by dir / by card; children kept; trashed card is tombstone against re-sync | W3 | R1 (the tombstone check is a real branch) + R4 | yes | no |
| unmount ambiguity / no-mount-here errors (2 checkThrows) | W3 | R1 + R8 (full message text) | yes | no |
| `bbx drive status` text report (3 checkText incl. "Not in folder: 1") | W3 | R2/R8 (human CLI output, nothing parses it) | partly; the "quiet" re-run check is R6 of the first | no |
| legacy `folders` config -> card conversion; idempotent second sync; log text | W3/W4-ish migration | R4 + R8 (log line text) | yes | no |
| conversion refuses occupied dir; refuses dir with two mounts; refuses `../escaped` | W3 | R4 + R3 (path escape) + R8 (3 long log strings incl. unrelated not-in-folder lines) | yes | no |
| corrupt config -> `{ok:false}` and sync failure, never "no mounts" | W2-flavoured (stated failure mode) | R1 + R4 | yes ("would silently drop the mounts it still owes a conversion") | no |
| path-outside-box refusals ×5, box-root-absolute mounts (`/_content/...`) | W3 (shared/ref-path fail-closed) | R3 | yes | no; 5 near-identical refusals are R6 of one claim across 3 entrypoints (defensible: 3 code paths) |
| symlinked dir refused on final filename, for link/mount/unmount | W2 ("Round-7 hardening finding 3 ... would write New.glink.card straight into src/") | R3 | yes | no |

Counts: W3 ≈ 10 groups, W2 2. R1 7, R2 3, R3 2, R4 3, R8 4 (log/message text), R6 2. Comments say why in 11/12. No weak examples. The weakness is R8: six `checkText` against multi-line log output that includes lines unrelated to the claim (the "not-in-folder" lines in the two-mounts test), so a reworded log breaks three tests.

Cite: `"A mount is not a promise for later:"` → `t.check(result, mountedRecipes)`; `"shared/ref-path.ts's check above is lexical only."` → `t.check(await refusal(linkDriveItem({... target: "/_content/code/New"})), "SymlinkedMountTargetError: ...")`.

## 2. beebox/test/connectors/gmail/drafts.test.ts

376 lines; first seen 2026-04-28; 7 tests, 23 checks.

| group | W | R | why | weak |
|---|---|---|---|---|
| new outbound uploaded, MIME raw, card stamped with id/url | W3 | R2 (MIME wire format + card on-disk format) | partly (what, not why) | no |
| reply inherits In-Reply-To/References/threadId from source card | W3 | R2 | yes | no |
| box-anchored absolute ref resolves the same | W4→kept (header: "Agents sometimes write a longer path") | R1 (ref resolution branch) but R6 of the previous MIME check | partly | no |
| unresolvable in-reply-to: no upload, error named, `gmail-draft-error` stamped, no retry, health check lists it, fix retries | W2 ("we'd rather fail loud than upload it as a brand-new thread") | R1 ×4 distinct branches + R2 (health-check shape) + R8 (error text, `str` with `…` truncation) | yes | no |
| HTTP 400 strands; transient failure starts `failing-since`; second failure leaves card; 7-day give-up; delete error line retries | W3 (stated policy "Nothing retries forever") | R1 ×4 | yes | no |
| already-stamped skipped | W3 | R1 (guard) | yes | no |
| received email-message not treated as outbound | W3 | R1 | yes | no |

Counts: W3 5, W2 1, W4 1. R1 6 groups, R2 3, R8 2, R6 1. Why 5/7. None weak. Note the `offline` fake is built by spreading the real fake and overriding `createDraft` — injection without a mock library, as the doc asks.

Cite: `"Gmail refusing a draft as malformed (HTTP 400) cannot be fixed by retrying."` → `t.check(gaveUp, \`...gmail-draft-error: "Upload kept failing for 7 days, since ${eightDaysAgo}: socket hang up"...\`)`.

## 3. beebox/test/services/tailscale.test.ts (service-fake test)

561 lines; 2026-07-20; 12 tests, 15 checks (most are table checks covering 5–12 inputs each).

| group | W | R | why | weak |
|---|---|---|---|---|
| 12-row state table (cli-error, unrecognized output, unknown BackendState, NoState..InUseOtherUser, https-disabled, empty DNSName) | W3 (plan Track B) | R1 (each row is a branch; e.g. nonzero serve exit must not read as "unconfigured") + R8 (every `nextStep` string and doc link) | yes, a bullet per rule in the header | no |
| 7-row serve/probe table (unconfigured, drift, garbage, foreground Funnel, probe-failed, exposed-unauthenticated, posture-ambiguous) | W3 | R3 (Funnel = public; open box behind Serve) + R1 + R8 | yes | no |
| binary-absent, NeedsLogin, Funnel-with-correct-serve, ready, ready+guarded router | W3 | R3/R1; NeedsLogin is R6 of row "NoState" | yes | no |
| `parseStatusJson` drift vs passthrough | W3 | R2 (external CLI JSON shape) | yes | no |
| `toBackendState` 3 values | W3 | R5 (a lookup table) | partly | no |
| `hasFunnelForTarget` top-level + foreground | W2-ish ("A foreground Funnel config ... is caught too") | R3 | yes | no |
| `loopbackProxyPort` 4 inputs | W3 | R1/R3 (non-loopback must not match) | yes | no |
| `parseServeConfig("" / "null" / "{}")` | W3 | R2 | yes | no |
| `reportToJson` ready shape | W3 | R2 (agents consume) but nextStep is `any(String)` | partly | no |
| `formatReportHuman` ×3 | W3 | R8 | partly | no |
| `classifyTargetPosture` 4 cases + refusal text | W3 ("Track C") | R3 + R8 (very long refusal string) | yes | no |
| `deriveTailscaleBaseUrl` 4 inputs | W3 | R1 (loopback host preferred) | yes | no |

Counts: W3 11, W2 1. R1 5, R2 3, R3 4, R5 1, R8 4. Why 9/12. None weak. This is not a test *of* the fake: the fake scripts two CLI subcommands and the machine under test is real. ~40% of the literal text in this file is `nextStep` prose, which is R8 ballast attached to R1/R3 checks.

Cite: `"Serve and probe states"` → row `"probe says open": { state: "exposed-unauthenticated", ... }`.

## 4. beebox/test/services/claude-chat.test.ts

164 lines; 2026-04-19 (current content mostly 2026-10); 4 tests, 9 checks.

| group | W | R | why | weak |
|---|---|---|---|---|
| env forwarded exactly | W5 | R5 (`env: dropUndefined(opts.env)` — the test passes the same literal back) | no | yes: passes if the function returned `opts.env` untouched; would only catch an env rewrite |
| `settingSources: ["project"]`, `settings.disableClaudeAiConnectors`, `claudeMdExcludes` list | W2 (names closed issue 2026-10-08 host connectors) | R3 | yes | no |
| `disallowedTools` list of 12 | W2 (issue 2026-10-09 push to host phone) | R3 + R8 (order of list) | yes | no |
| landmark chat: excludes start above boxRoot | W2 (issue 2026-10-09 landmark excludes box root) | R3/R1 | yes | no — projected to 4 booleans, so R1 not R8 |
| `warmSlotKey` speculative vs coined | W3 | R1 | yes | no |
| `warmCompatible` 4-way matrix; telemetry env; boxRoot | W3/W2 (telemetry case reads like a found bug) | R1 + R3 (wrong chat served by warm slot) | yes | no |

Counts: W2 3, W3 2, W5 1. R3 4, R1 2, R5 1, R8 1. Why 5/6. One weak (first test).

Cite weak: `"The real Claude adapter forwards the exact BBX environment..."` → `t.check(built.queryOptions.env, {...same three keys...})`.

## 5. beebox/test/google/auth-status.test.ts

194 lines; 2026-07-28; 2 tests, 18 checks (one long narrative test).

| group | W | R | why | weak |
|---|---|---|---|---|
| `isInvalidGrantError` 5 inputs (structured, ReAuth JSON-in-message, ETIMEDOUT, backendError, undefined) | W3 (plan google-auth-reauth-health) | R2 (gaxios error shape) + R1 | yes ("a network blip that told the boxholder to go re-authorize would be worse than silence") | no |
| transient -> null; status untouched | W3 | R1 | yes | no |
| invalid_grant -> typed error; status dead; `configured` per-box vs machine-wide token | W3 | R1 + R3 | yes | no |
| re-mark preserves `needsReauthSince` | W3 ("health message and notification latch key on when it broke") | R1 | yes | no |
| fresh token clears; bare expiry write does not | W3 | R1 ×2 | yes | no |
| on-disk token file shape | W3 | R4/R2 | yes | no |
| corrupt token file: write refuses, bytes untouched; absent file starts fresh; no temp sibling | W2 ("used to fall through to {} ... wiping the one refresh token shared by gmail, calendar, and drive") | R1 + R4 | yes | no |

Counts: W3 6, W2 1. R1 6, R2 2, R3 1, R4 2. Why 7/7. None weak. Process-global env (`BBX_GOOGLE_TOKENS_FILE`) set at module top is the cost of the design; teardown handles it.

Cite: `"A transient failure is classified..."` → `t.check(failure, { name: "GoogleTokenStoreCorruptError", message: ..., storePath: TOKENS_FILE })`.

## 6. beebox/test/services/google-drive/schemas.test.ts

164 lines; 2026-01-30 (oldest in sample); 4 tests, 10 checks.

| group | W | R | why | weak |
|---|---|---|---|---|
| well-shaped file validates (`t.check("ok","ok")` after `validateResponse`) ×6 | W3 | R7 (tests zod accepts a conforming object) | partly | yes: `t.check("ok","ok")` passes if `validateResponse` is a no-op; only the throw side proves anything |
| missing `id`/`trashed` -> issues list | W3 | R2 (external API drift detection) | yes | no |
| missing `sheetId` -> issue | W3 | R2 | yes | no; R6-ish of the previous |
| recursive doc (table-in-cell, deep nesting) | W3 ("recurses through z.lazy") | R1 (the lazy recursion is a thing an edit breaks) | yes | yes for the same reason: a no-op validator passes |
| read-only share omits `revisionId` | W2-flavoured (a real response shape) | R2 | yes | yes (no-op passes) |
| numeric/boolean sheet cells | W2-flavoured | R2 | yes | yes (no-op passes) |

Counts: W3 4, W2 2. R2 4, R7 1, R1 1, R6 1. Why 5/6. Six of ten checks are the weak `t.check("ok","ok")` idiom (a doctest-era leftover: the conversion kept "it did not throw" as a check). The accept-side claims are real (a too-strict schema would reject real Google payloads) but the assertion form cannot distinguish "accepted" from "not validated".

Cite weak: `"A Google Doc body is a tree:"` → `validateResponse(doc, {...}); t.check("ok", "ok");`.

## 7. bin/test-select.test.ts

275 lines; 2026-08-25; 14 `node:test` tests, 0 `t.check` (uses `assert.deepEqual`; header explains: the thing under test decides which tests run, so it cannot live in the tap suite).

| group | W | R | why | weak |
|---|---|---|---|---|
| union rule: implicated + scoped, out-of-scope paths ignored | W1 + W3 (`test-select-lib.ts` is "the pure half"; `graphOf()` states a graph directly "so the rule is tested without an esbuild pass") | R1 | yes | no |
| spawner selected by change to what it spawns only | W2 ("Until the 2026-08-25 revision every spawner ran on every selected run — ~10 files and ~35s") | R1 | yes | no |
| dist/cli.mjs follows bundle inputs; null fails open | W3 | R1 ×3 | yes | no |
| change nothing imports selects nothing (no fallback) | W3 (plan revision 2026-08-25) | R1 (someone re-adds the FULL fallback) | yes | no |
| nothing in scope, spawners included | W3 | R6 of the previous two | partly | no |
| changed test selects itself | W3 | R1 | no | no |
| unresolved entrypoint always selected | W3 | R1 | yes | no |
| careful-tier excluded unless it is what changed | W3 ("mechanism C") | R1 | yes | no |
| `spawnedSourceRefs`: import is not a spawn; literal without spawn is not a spawner | W3 | R1 | partly | no |
| `spawnerEdges` over a fixture package (child-only import detected; honest spawner excluded) | W2 ("Track 3c ... no change to that source would ever select it") | R1 | yes | no |
| `packageRelative` incl. `../bin/` | W2 ("the runner found no such file and refused the whole selection") | R2 (path form tap accepts) | yes | no |
| `emptyRunLines` | W3 | R2 (`finish` parses the summary line) + R8 | yes | no |
| internal error exits non-zero (spawns the CLI) | W3 | R2 (callers read exit code) | yes | partly: `assert.match(stderr, /test-select:/)` only |

Counts: W1 1 (file-level), W2 3, W3 9. R1 9, R2 3, R6 1, R8 1. Why 11/13. W1 evidence: `test-select-lib.ts` header "Which tests a change calls for — the pure half" and the CLI "strips the package prefix at print time"; lib and test landed in the same commit (088046895), so the boundary was drawn for testability from the start rather than forced later.

Cite: `"a change nothing imports selects nothing — there is no full-suite fallback"` → `assert.deepEqual(selection.selected, [])`.

## 8. bin/test-ledger.test.ts

392 lines; 2026-08-09; 36 tests, 0 `t.check` (`node:assert`).

| group | W | R | why | weak |
|---|---|---|---|---|
| TAP parse per-file + durations; no timing -> 0 | W3 | R2 (tap's TAP output) | partly | no |
| ignore indented subtest lines | W2-ish ("would report thousands of files and wreck every denominator") | R1 | yes | no |
| failure recap lines ×3 | W3 | R8 + R2 (rerun command) | yes | no |
| porcelain: ` M` keeps first char | W2 (explicit regression) | R1 | yes | no |
| porcelain: staged/untracked/deleted; empty; space; ` -> ` not a rename; rename consumes origin | W2 (4 of these were added in "nine defects found by the pre-land code review", 33694b9e2) | R2 (git -z format) + R1 | yes for rename/space; no for staged/empty | no |
| classifyFailure attached/unimplicated/unknown | W3 | R5 (three-way lookup) | partly ("the number the whole instrument exists to produce") | no |
| deriveFlakes: same tree flake; different tree not; different commit not; later run without file proves nothing; repeated cycles count | W3 | R1 ×5 | yes | no |
| carefulCandidates: over/under bar; window counts only runs that ran the file; member reported not re-proposed; bailed run no evidence | W3 (mechanism C) | R1 ×4 | yes | no |
| summarize: denominator counts runs including the file; never-failed appears; incomplete run excluded (added in review commit); completed red counts; median | W3/W2 | R1 ×4, R5 1 (median) | yes mostly | no |
| hashFileset order-independent / different | W3 | R1 | no | no |
| record without tier/concurrency still counts | W2 ("sixteen days of records that motivated it have neither") | R4 | yes | no |
| record with tier/concurrency carries both | W5 | R7 (`rec({tier:"careful"}).tier === "careful"` tests the spread operator) | no | yes |
| marker not a measured run; marker adds no denominator | W3 | R1 | partly | no |
| terminateChild: waits; escalates to SIGKILL; already-exited returns | W2-ish ("the slot is released after tap is gone") | R1; test comment on waiting for the handler to be installed shows awareness of vacuity | yes | no |

Counts: W2 8, W3 20, W5 1. R1 22, R2 3, R4 1, R5 2, R7 1, R8 1. Why ≈ 28/36. One weak (`a record from a run under the semaphore carries both`). This is the file with the clearest W2 trail in git: the review commit added exactly the porcelain and denominator cases its message names.

Cite W2: `"an unstaged modification keeps its first character"` → `assert.deepEqual(parsePorcelainPaths(Z([" M bin/test-graph.test.ts"])), ["bin/test-graph.test.ts"])`. Cite weak: `"a record from a run under the semaphore carries both"` → `assert.equal(record.tier, "careful")`.

## 9. bin/issues.test.ts

333 lines; 2026-07-10 (current form 2026-08-24); 20 tests, 1 `t.check`-free (`node:assert`; header says the deviation from `bin/AGENTS.md` is deliberate because fake-embedder call logs are "assertion-shaped").

| group | W | R | why | weak |
|---|---|---|---|---|
| deriveDate prefix only; `about-2026-...` not picked up | W3 | R1 | yes (one line) | no |
| discoveredInWorkstream takes token not prose | W3 | R1 | yes | no |
| normalizeWorkstreamName two spellings | W3 | R1 | no | no |
| loadIssueEntries derives fields (6 asserts over fixture) | W3 | R2 (issue frontmatter format) | no | no |
| status default open / closed / all (`.length === 5`) | W3 | R1; the `.length` assert is weak | no | partly |
| OR within, AND across; labels AND | W3 | R1 (a plausible edit flips label semantics) | yes ("unlike every other filter") | no |
| needs/next-action/research/since/discovered-in each narrow | W4 kept (one assert per filter) | R1, but 5 filters in one test = R6-ish breadth | partly (undated/--since line) | no |
| groups rank by size, min, no synthetic group, labels multi-bucket | W3 | R1 | yes | the "sum of counts == 3" assert is weak |
| first refresh embeds all; second embeds none; one batched call | W3 | R1 + cost guard | yes (assert messages) | no |
| only changed doc re-embedded; removed leaves index | W3 | R1 | partly | no |
| rebuild re-pays; directory listing | W3 | R1 + R4 (files on disk) | no | no |
| frontmatter-only edit: no embed, index updated | W2-shaped ("stale-index and stale-vector questions must answer differently") | R1 | yes | no |
| text-only run drops stale vector | W2-shaped | R1 | yes | no |
| failed embed retried not remembered | W3 | R1 | yes | no |
| public scope own cache | W3 | R1 | yes | no |
| vector modes refuse without vector | W3 | R1 | no | no |
| no service -> text search still answers | W3 | R1 | no | no |
| where clause restricts | W3 | R1 | no | no |
| semantic: a doc is its own nearest neighbour; exclude works | W3 | R7-ish (property of the deterministic fake embedder as much as of the ranker) | no | partly |

Counts: W3 15, W2 2, W4 1. R1 16, R2 1, R4 1, R7 1. Why ≈ 9/20 (lowest in sample). Several `.length` asserts (`assert.equal(x.length, 5)`), which the beebox rule bans.

Cite: `"a frontmatter-only edit rebuilds the index but costs no embedding"` → `assert.equal(refreshed.embeddedThisRun, 0, "the embedded text did not change")`.

## 10. bin/commit-blocklist-check.test.ts

124 lines; 2026-07-05; 13 tests (`node:assert`).

| group | W | R | why | weak |
|---|---|---|---|---|
| parseBlocklist classifies kinds, keeps line numbers | W3 | R2 (blocklist file format) | no | no |
| literal case-insensitive substring; dots literal | W3 | R3 | partly | no |
| `re:` word-bounded | W3 | R3 | partly | no |
| invalid regex fails closed | W3 | R3/R1 | yes (title) | no |
| empty `re:` and bare `!` ignored ("not match-everything footguns") | W2-shaped | R3 | yes | no |
| allow covers span; allow does NOT un-block outside span ("no smuggling") | W3 | R3 ×2 | yes | no |
| file: ignore by basename at any depth; slash glob full path, `**` | W3 | R1 | yes | no |
| hits carry file:line+entry, never a value | W3 | R3 (not leaking the blocked term) | yes | no |
| parseAddedLines line numbers; ignores deletions and /dev/null | W3 | R2 (git diff -U0 format) | partly | no |
| `--check-text`: a name matched/allowed/ignored like a diff line; `<name>` pseudo-path not hit by a file glob | W2 (a workstream name "never appears as a staged line") | R3 | yes | no |

Counts: W3 10, W2 2. R3 8, R2 2, R1 1. Why 8/13. None weak; several asserts are `.length === 1/0` which is acceptable for a hit-count but would pass on a wrong hit.

Cite: `"an allow rule does NOT un-block a match outside its span (no smuggling)"` → `assert.equal(findBlocked(added, entries).length, 1)`.

## 11. schedules/full-suite/run.test.ts

389 lines; 2026-08-25; 34 tests (`node:assert`). Header: "The I/O halves (run.ts, checkout.ts) are a git worktree and a suite run; what they need to be right about is here" — W1 stated as design.

| group | W | R | why | weak |
|---|---|---|---|---|
| parseLandings oldest-first; newline in subject (unit-separated format); empty | W2 ("a line-splitting parser turns the second line into a landing with no commit") | R2 (git log format the schedule itself chose) | yes | no |
| workstreamOf reads `bin/land` subject; null otherwise | W3 | R2 (cross-tool: bin/land's merge subject) | yes | no |
| lastTestedCommit: newest marker, ignores someone's own `pnpm test`, red batch counts; tier record alone not tested ("a run that died between the two tiers"); incomplete marker ignored; null before first run | W2 ×2, W3 | R1 ×4 | yes | no |
| marker records no files | W3 | R5 (`completionMarker` builds a literal) | partly | no |
| batchExit worst tier / killed / never completed | W3 | R1 | partly | no |
| wide failure is environment (bar ±1) | W3 | R1 | no | no |
| directory failing identically under bar (13-file loader block); cluster needs same error; too few; no readable error never clustered | W2 ("The plan's own example ... thirteen bogus issues if it is bisected") | R1 ×4 | yes | no |
| firstErrorLine folded scalar | W3 | R2 (tap YAML block) | no | no |
| environment alert says which rule fired | W3 | R8 (`assert.match` on prose) | no | no |
| classifyFailure order | W3 | R1 | yes | no |
| bisectStep; narrowBisect; bisect finds culprit for every position in ≤4 asks; single landing asks nothing | W3 | R1 (the exhaustive 9-culprit loop is strong) | yes | no |
| isHostQuiet: pressure independent of load (2026-09-11); null pressure ok; warn trips (2026-09-25) | W2 ×2 (dated incidents) | R1 | yes | no |
| tierProducedResults: clean exit trusted; refusal output vs real TAP (2026-09-11) | W2 | R1 | yes | no |
| issuePath slug; unstage args; renderIssue frontmatter/home-path `~`/no H1; direct commit claims no workstream | W3 + W2 (`path-leak-check refuses the report`) | R2 (issues/ file format, path-leak-check) + R8 | yes | no |
| failureExcerpt: stops at next result; missing block says so; whole path not prefix (`.bak`) | W2-shaped (`.bak`) | R1 | yes | no |

Counts: W2 ≈ 10, W3 ≈ 22. R1 ≈ 20, R2 6, R5 1, R8 3. Why ≈ 24/34. None weak. Highest density of dated incident citations in the sample (2026-09-11 ×2, 2026-09-25, "08-31 file-watcher").

Cite W2: `"isHostQuiet needs both load under bar and pressure under warn"` → `assert.equal(isHostQuiet({ load1: 4, bar: 8, level: 4 }), false)` with comment "2026-09-11: load1 8 read quiet against a bar of 12 while swap thrashed".

## 12. schedules/full-suite/trust.test.ts

197 lines; 2026-09-02; 11 tests. Header: written "on the shape of the real incident: the 2026-08-30..09-01 event".

| group | W | R | why | weak |
|---|---|---|---|---|
| median empty/odd/even | W3 | R5 | no | no |
| durationHistories ignores other source, marker, groups by commit | W3 | R1 | yes | no |
| usual speed trusted / thrashed untrusted | W2 (incident) | R1 | yes | `factor < SLOWDOWN_UNTRUSTED` is a comparison assert |
| one slow file cannot condemn (median of ratios) | W3 | R1 | yes | no |
| too little history -> no judgment; sub-second tests say nothing | W3 | R1 ×2 | yes | no |
| sustained load cannot train the baseline | W2-shaped ("the gate goes blind exactly when it matters") | R1 | yes | no |
| tiers judged together (careful record shares commit) | W3 | R1 | yes | no |
| alertCondition keys; blamed order-blind | W2 (eight identical alerts) | R1 | yes | no |
| deferred alert text | W3 | R8 | no | no |

Counts: W2 3, W3 8. R1 8, R5 1, R8 1. Why 9/11.

## 13. schedules/retrospective/lib.test.ts

95 lines; 2026-10-07; 9 tests (`node:assert`), no file header.

| group | W | R | why | weak |
|---|---|---|---|---|
| windowStart from last run / default | W3 | R1 | yes (title) | no |
| windowDays rounds up, floor | W3 | R1 | title only | no |
| nextWatermark | W3 | R1 | title only | no |
| parseStored validates, never throws | W3 | R1/R4 (stored JSON) | title | no |
| isEscapedBug 4 cases | W3 | R1 | title | no |
| isPreventionPath 7 yes / 4 no incl. `bin/contest.ts` (substring trap) | W4 kept (the `contest` case is the one that earns it) | R1 | partly | no |
| issueFacts frontmatter incl. quoted title, flow list, no frontmatter | W3 | R2 (issue file format) | title | no |
| hasWork: own entries never start a run | W3 | R1 | yes | no |
| formatPacket (4 `assert.match` + 1 ordering) | W3 | R8 | no | no |

Counts: W3 8, W4 1. R1 6, R2 1, R8 1. Why: titles carry the rule; no prose comments. Nothing weak. Typical "pure lib + I/O shell" schedule file: every function tested is pure, which is W1 in the file structure rather than in any example.

## 14. workstreams-app/test/router/server/auth.test.ts

386 lines; 2026-07-21; 26 tests (`node:assert`). Header: "Every planned row of the plan's Failure-modes table ... NON-VACUITY: each allow test would flip to a deny if the matching guard were neutered."

| group | W | R | why | weak |
|---|---|---|---|---|
| UDS trusted-local allows everything (5 urls, all-deny fakes) | W3 (plan table) | R3 | yes | no |
| login page + pairing-redeem allowed unauthenticated | W3 | R3 | yes | no |
| control mutating: owner+CSRF allow; CSRF fail 403 no redirect; no owner 401 and CSRF never consulted; revoked session 401 | W3 | R3 ×4 (order-of-checks proved via spy) | yes | no |
| control-read owner allow | W3 | R3 | no | no |
| dev-read: owner; browse key alone; neither -> 401 + redirect only for HTML | W3 | R3 | yes | no |
| browse key does NOT widen control surfaces (9 method/url rows incl. `#` fragment divergence) | W2-shaped (fragment case reads like a found hole) | R3 | yes | no |
| status: never redirects; infra pages redirect navigations | W3 | R3/R8 (redirect policy) | yes | no |
| box: mobile for target allow; mobile for OTHER box 401; session allow; agent bearer short-circuits (spy); neither -> 401; unresolvable slug fails closed and no box-auth attempted (spy) | W3 | R3 ×6 | yes | no |
| root-worktree API resolves to picker | W3 | R3 | no | no |
| worktree-asset: any box credential; none; other worktree's credential refused | W3 | R3 ×3 | yes | no |
| box list reaches hub filtering boundary; none -> 401 | W3 | R3 | yes | no |
| unknown route 404 even for owner, never redirect | W3 | R3 | yes | no |

Counts: W3 25, W2 1. R3 26 (every example), R8 1. Why ≈ 20/26. None weak; the spy-flag pattern (`csrfConsulted`, `mobileConsulted`, `boxAuthAttempted`) proves short-circuit order, which a whole-value check could not. Uses `assert.equal(d.allow === false && d.status, 401)`, the "compare against a boolean expression" form the beebox rule bans; a `t.check(d, {allow:false,status:401,reason:...,redirectToLogin:false})` would be one line and stronger.

Cite: `"TCP box: unresolvable/duplicate slug fails closed → 401, no per-box auth attempted"` → `assert.equal(boxAuthAttempted, false, "no box-auth runs once the target is unresolvable")`.

## 15. workstreams-app/test/frontend/lib/selection-anchor.test.ts

117 lines; 2026-08-22; 6 tests, 6 checks.

| group | W | R | why | weak |
|---|---|---|---|---|
| four directive shapes round-trip | W3 | R2 (URL text-fragment syntax, read back hours later) | yes | no |
| lone quoted string ending in `-` is text, not prefix | W2 ("parsed the whole fragment to null, so a comment on a hyphen-final selection silently stopped highlighting") | R1 | yes | no |
| commas/dashes survive; percent/space survive | W3 | R2; the second is R6 of the first | yes | no |
| `:~:text=` prefix optional | W3 | R1 | yes | no |
| empty payload -> null ×2 | W3 ("an EMPTY textStart ... would ask the matcher to find the empty string") | R1 | yes | no |

Counts: W3 4, W2 1. R1 3, R2 2, R6 1. Why 6/6. None weak. `roundTrip()` normalizes key order and comments why ("Key ORDER is an artifact of how the parser builds its object; the contract is the values") — deliberate avoidance of R8.

## 16. workstreams-app/test/server/main/recency.test.ts

177 lines; 2026-08-22; 1 test, 11 checks, real git repos in tmp.

| group | W | R | why | weak |
|---|---|---|---|---|
| feed spans checkouts, labelled; sorted newest first | W3 (plan general-browser Track 3) | R1 | yes | the sort check compares `ats` to `ats.toSorted()` — passes for 2 items in either order only if equal `at`; acceptable |
| branch reports own commits not inherited (`main..HEAD`) | W2-shaped ("twenty copies of the same commits") | R1 | yes | no |
| in-progress marked, outranks committed; new untracked file appears | W3 | R1 | yes | no |
| same path on two branches = two entries | W3 | R1 | yes | no |
| distribution counts | W3 | R1; R6-ish of the first distribution check | yes | no |
| unscannable checkout named in `unavailable`, others still listed | W3 | R1 | yes | no |
| truncation flagged | W3 | R1 | yes | the files entry is all `any(...)` patterns; only `truncated: true` carries weight |

Counts: W3 6, W2 1. R1 7, R6 1. Why 7/7. Heavy `any(Number).int()` on `at` because real git timestamps are used; a fixed clock for commits (`GIT_COMMITTER_DATE`) would make the values exact, as check.md recommends.

## 17. tap-check/test/check/compare/report.test.ts

486 lines; 2026-10-17; 29 tests, 31 `t.check*` plus ~60 `t.ok/t.notOk` (this package tests the harness itself, so tap asserts are the only option without circularity).

| group | W | R | why | weak |
|---|---|---|---|---|
| equal values pass, key order; NaN | W3 | R1 | no | no |
| extra key / missing key / nested path / array length / wrong kind: full report text | W3 | R2 (report format agents paste from) + R8 | no (titles) | no |
| undefined-valued key compared; function key not | W3 (check.md states it) | R1 | yes (assert messages) | no |
| class instance by own data; Error name/message/data; Map/Set order; Date forms | W3 | R1 ×4 | partly | no |
| patterns: any/refinements/uuid/isoDate/oneOf/not/is/instanceOf (20 asserts) + 2 report texts | W3 | R1; strict below/above explicitly | partly | no |
| str; [others]; optional; unordered (multiplicity, general-pattern-first); containing | W3; unordered "A general pattern listed first must not take the item a literal needs" is W2-shaped | R1 | partly | no |
| suggestion keeps matched patterns; NO_EXPECTED generalizes | W3 | R2 (the suggested: block agents paste) | partly | no |
| anything() refused as whole; functions/promises; circular | W3 | R1 | no | no |
| diff shows only real differences | W3 | R8 | no | no |
| capture keeps value; unmatched capture throws | W3 | R1 | no | no |
| "review findings: no silent passes" (13 notOk: inherited keys, `__proto__`, symbol keys, RegExp/boxed/ArrayBuffer/private-field against `{}`, -0, thenable, invalid Date, real "[others]" key) | W2 (explicitly "review findings") | R1 ×13, every one a fail-closed rule | yes (one line each) | no |
| str tries every split; t.check awaits promise; mismatches name the likely fix (misspelled key, «» wildcards, Date vs short date, unordered hint; hint never fails a pass) | W2 (the wildcard hint is a doctest-migration symptom) | R1 + R8 (hint text via regex) | yes | no |

Counts: W3 ≈ 22, W2 3. R1 ≈ 20, R2 3, R8 4. Why ≈ 12/29 (titles do the work). None weak. The `"review findings"` test is the best example in the sample of W2 made explicit and each example being a distinct fail-closed branch.

## 18. beebox/test/scripts/release.manifest.test.ts

111 lines; 2026-09-27; 1 test, 6 checks. Tests `package.json` against the filesystem; no source module under test.

| group | W | R | why | weak |
|---|---|---|---|---|
| exports targets include `./dist/exports/cards.js` (non-vacuity guard) | W3 | R7-ish (guards the test) | yes ("so the check below cannot pass by checking nothing") | no |
| every exports target covered by `files` | W3 (Track F; "the failure mode it catches is real: ... ERR_MODULE_NOT_FOUND in a stranger's box") | R2 (npm tarball contract) | yes | no |
| bin targets include `./bin/bbx`; all covered | W3 | R2; R6 of the exports check in form | yes | no |
| `files` names no missing checked-in entry | W3 | R2/R4 | yes | no |

Counts: W3 4. R2 3, R7 1, R6 1. Why 4/4. The helpers (`coveredByFiles`, `exportTargets`, `findMissing`) live in the test; a bug in them hides a bug in package.json (the doc's "a fixture built by the helper under test agrees with that helper when both are wrong" warning applies).

---

## Overall tallies (groups, not raw checks; 18 files, ≈ 190 groups)

Axis W: W1 explicit in 1 example-level case (test-select union rule via `graphOf`) and in the file structure of 6 files (test-select-lib, test-ledger-lib, full-suite lib, trust, retrospective lib, router auth with injected deps); W2 ≈ 45 (24%); W3 ≈ 135 (71%); W4 ≈ 4; W5 ≈ 3.

Axis R: R1 ≈ 150; R2 ≈ 40; R3 ≈ 50 (concentrated in router auth 26, tailscale, blocklist, mounts, claude-chat); R4 ≈ 10; R5 ≈ 7; R6 ≈ 10; R7 ≈ 5; R8 ≈ 30 (mostly `nextStep`/log/refusal prose riding on otherwise R1/R3 checks).

Comment states why: ≈ 70% of groups. Lowest: bin/issues (≈45%), tap-check report and retrospective (titles only). Highest: auth-status, drafts, selection-anchor, recency (100%).

Weak examples (pass against a no-op): 9 of ≈ 190. Six are the `t.check("ok","ok")` idiom in drive schemas; one env passthrough in claude-chat; one spread-operator test in test-ledger; one `.length` sum in issues.

## Observations

1. W3 dominates and is usually honest: the plan-defined contract is cited by path (`docs/implemented-plans/tailscale-expose-and-protect.md Track B`, `expose-dev-router.md` Failure-modes table, `change-based-test-selection.md` 2026-08-25 revision). W2 clusters where there was an incident log: full-suite run/trust (dated 2026-09-11, 09-25, 08-31), test-ledger (the "nine defects" review commit added six named cases), claude-chat (three closed-issue paths), auth-status (the wiped-token-file story). Files written from a plan before anything ran (retrospective lib, drive schemas) show no W2 at all.

2. W1 shows up as file structure, not as examples. `test-select-lib.ts` ("the pure half"), `test-ledger-lib.ts` ("the I/O shell lives in test-ledger.ts"), `schedules/full-suite/lib.ts`, `trust.ts`, `retrospective/lib.ts`, and the router's `RouterAuthDeps` all exist so the test can state inputs directly; the lib and its test land in the same commit. No example in the sample says "this used to be untestable and was split". The doc's claim that testing forces decomposition is supported by the split-at-birth pattern, not by after-the-fact extraction.

3. bin/ and schedules/ tests differ in character from beebox app tests in three ways: they use `node:assert` (test-select and test-graph cannot run inside the suite they select; the others followed), they test pure functions over small literal inputs with one claim per `test()` and the claim in the title, and they carry more dated W2 citations. beebox app tests are longer narrative files (one `test()` with 10–18 checks: auth-status, recency, drafts) where the prose comment between checks carries the why. The narrative form yields higher why-coverage; the assert form yields more distinct claims per line.

4. Tests of service fakes: none in the sample is a test *of* a fake. tailscale.test.ts, mounts, drafts, issues all drive real logic through a fake (`createFakeTailscaleDeps`, `createFakeGoogleDrive`, `createFakeGoogleGmail`, `createFakeEmbeddings`). The one R7-ish case is issues' "a document is its own nearest neighbour", which holds because the fake embedder is deterministic, so it proves the fake plus the ranker together.

5. R8 is the main dead weight, and it rides on good tests. Tailscale's 12-row table is R1 per row, but each row also pins a 100-character `nextStep` and a doc link; mounts' conversion tests pin three-line log output including lines about other cards; claude-chat pins `disallowedTools` in array order. These break on a restyle and on a bug alike, so a failure needs reading to classify. selection-anchor's `roundTrip()` normalizer and claude-chat's landmark test (projected to four booleans) show the alternative.

6. The weak idiom is a doctest leftover: `validateResponse(x, …); t.check("ok","ok")` in drive schemas is "it did not throw" written as a check. A no-op validator passes six of ten checks there. The fix is cheap (`t.check(() => validateResponse(...), is(undefined))` or asserting the parsed value), and this file is the only one in the sample where it recurs.

7. R6 is rare and mostly defensible: five path-escape refusals in mounts cover three entrypoints; the "quiet" status re-run and drafts' box-anchored-ref MIME check are the genuine second proofs. The doc's "second test proving the same claim with a different literal is a defect" is largely followed.

8. R3 density tracks where the box talks to the outside: router auth (26/26), tailscale (Funnel/open-box/ungated-router), blocklist (allow-span smuggling, `<name>` vs file glob), claude-chat (host connectors, push tools, landmark excludes), mounts (path escape, symlink). These files also have the highest why-coverage and the clearest W2, which suggests trust-boundary tests are the ones people write after something leaked rather than from a plan.
