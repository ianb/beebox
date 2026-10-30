# Test-value evidence: core / shared / lib / schemas sample

Worktree: test-value-research. Paths below are relative to `beebox/`.
Ages are first-add dates following the pre-2026-10-18 `.doctest.md` name (and the 2026-08-30 the old product name rename). "Examples" counts `test()` blocks / `t.check*` calls. Classification is per example or per group of near-identical checks; one example can carry two R codes when both apply (e.g. R1+R8: guards a branch but pins the message wording).

Axes: W1 forced boundary; W2 pinned a bug that occurred; W3 defined a planned contract; W4 input exploration; W5 unclear.
R1 guards a branch; R2 cross-system contract; R3 trust/security; R4 migration/on-disk compat; R5 restates straight-line code; R6 second proof; R7 tests a fake/framework/type; R8 pins a wording/ordering choice.

## test/core (10 files)

### test/core/list-cards.test.ts — 30 lines, 2026-10-06, 1 test / 2 checks
Source: `src/core/list-cards.ts` (glob + `PUBLICATION_BUILD_OUTPUT_GLOB` ignore + `isPublicationBuildOutputPath` filter).
- W: W2 probable (commit 936612249 "Keep publication build trees out of box walkers"; comment states the rule, not a symptom) → counted W2.
- R: check 1 (`listBoxMarkdownFiles` → `["…/project/src/readme.md"]`) R1: edit that drops the glob from `MARKDOWN_WALK_PRUNE` or the dist predicate lists `dist/page.md`. Check 2 (`listBoxCardFiles` → `[]`) R1 but weak on its own: a no-op `listBoxCardFiles` passes it; only the positive sibling in check 1 makes the pair meaningful.
- Why-comment: partly (what is skipped; not why dist is skipped). Weak: check 2 yes.
- Counts: W2 1 | R1 2 (one weak).

### test/core/geo.test.ts — 48 lines, 2026-06-29, 5 tests / 5 checks
Source: `src/core/geo.ts` (`haversineMeters`, `matchPlace` with `distance <= radius && distance < bestDistance`).
- "haversine: one degree of latitude is ~111.2 km" `any(Number).above(111_000).below(111_400)` — W4/W3, R5 (fails only if the formula or Earth radius changes). Why: partly (a known fact, unstated).
- "haversine is zero for identical points" → `0` — R5/R6 (any distance formula gives 0).
- "a far-away fix matches nothing" → `null` — R5 (no-op `matchPlace` returning null passes: weak).
- "on overlap, the nearest center wins" `matchPlace(fix,[B, BIG_A])` → `BIG_A` — R1: a first-match-wins edit returns B. Why: yes.
- "strict radius — a fix just outside the radius does not match" → `null` — R1: an accuracy-inflation edit (`distance <= radius + accuracy`) breaks it; source comment says this is deliberate. Why: yes.
- Counts: W3 2, W4 1, W5 2 | R1 2, R5 3 (1 also R6). Weak: 1.

### test/core/migration-repair.malformed-question.test.ts — 74 lines, 2026-10-22, 3 tests (one loops ×2) / 4 checks
Source: `src/core/migration-repair.ts` (`question()` returns `{malformed}`; `"malformed" in existing` branches at lines 58, 93, 136), `migration-sweep.ts`.
- W2 for every example: commits f95b165b6 ("question() caught only ENOENT, so a … card edited into an invalid shape … threw out of every sweep") and 130469082 ("an exit 2 behind an open question records nothing").
- "a malformed question card is an attention item for the sweep and the health check" `{sweep:{status:"attention",questions:[CARD],applied:[]}, questions:[CARD], healthOk:false, named:true}` — R1 (edit: catch only ENOENT again) + R4 (migration bookkeeping).
- "a malformed question card stops a repair attempt as unanswered" `{result:{code:1,question:CARD,stale:true}, invocations:0}` — R1 (the `"malformed" in existing` branch at line 136; `invocations:0` proves no agent ran).
- "an exit 2 under an earlier {unanswered|malformed} question is deferred, not recorded" `{status:"deferred-repair", recorded:false, agents:0}` — R1+R4; the loop's two cases are R6 of each other (same branch, two inputs) — but the commit says both shapes failed, so both are keepers by the repo's own rule.
- Why: yes on every check ("An unreadable card is no authorization", "The open question holds no record of these leftovers"). Weak: no (a no-op throws). `named: health.message.includes(CARD)` is a projection, not the message.
- Counts: W2 4 | R1 4, R4 2, R6 1.

### test/core/engine-version.test.ts — 90 lines, 2026-07-04, 4 tests / 5 checks
Source: `src/core/engine-version.ts` (`readVersionField` try/catch → null; `mismatch = serving !== null && installed !== null && serving !== installed`).
- W3 all (header cites "Track E, chunk E2" of boxes-as-packages-v2).
- "`getServingEngineVersion` reads the running engine's own package.json" → `await realEngineVersion()` — R5 and tautological: the test reads the same file the code reads (check.md warns "a fixture built by the helper under test agrees with that helper when both are wrong").
- "A box with no installed engine reports installed: null" `{serving, installed:null, mismatch:false}` — R1: a naive `serving !== installed` would report mismatch on null. Why: yes ("a null side never mismatches").
- "installed engine differs → mismatch: true" `{serving, installed:"0.0.1", mismatch:true}` — R5 (straight-line comparison).
- "installed engine matches → no mismatch" — R6 of the comparison (third proof).
- Counts: W3 5 | R1 1, R5 3, R6 1. Weak: check 1 (same-source fixture).

### test/core/box.test.ts — 184 lines, 2026-03-03 (oldest in sample), 5 tests / 15 checks
Source: `src/core/box/package.ts` `scaffoldBoxRoot`, `box/structure/core.ts` `initBox`/`isValidBox`, `lib/paths/core.ts` `findBoxRoot`, `lib/box-identity.ts`.
- Directory listing `checkText(allDirs.filter(_), "_bookkeeping\n…\n_tmp")` — W3; R2 (on-disk layout other tools and agents walk) with R8 flavor: every added area edits this expected value (history: 6f27de3d8 added `_content/incoming`, 4763bc392 feedback). Why: no (the list is the claim).
- `pkg.beebox` → `{shapeVersion:3, created:isoDate()}` — R4 ("recorded in the tracked package.json … so a clone of the box is a box"). Why: yes.
- Marker file `{version:"1.0.0", shapeVersion:3, created}` — R4 (older engines read it). Why: yes.
- `isValidBox(boxRoot)` → true / empty dir → false — R5 pair; the false case is what makes it a branch (R1 marginal).
- `findBoxRoot(_content/inbox)` → boxRoot; unrelated dir → `null` — R1 and R3-ish ("fails closed … not a guess"). Why: yes.
- `readShapeRecord` then `initBox` again → same record — R1: an `initBox` that rewrites `created` breaks it. Why: yes.
- `.gitignore` `not(includes("**/*.attach/**/*.pdf"))` — R4 (manifest scheme retired, cd650c6ca); `includes("managed by bbx attachments unignore")` — R8 (a marker string); `includes("**/tmp-capture/**/*.attach/**")` — R1; `.gitattributes` `not(includes("filter=lfs"))` — R4 (LFS retired). Idempotent re-init byte-identical — R1 (edit: append instead of rewrite; "bbx init never dirties"). Why: yes. The file says these are "narrow checks on the lines that matter" — projections, not whole values.
- Counts: W3 15 | R1 5, R2 1, R4 4, R5 2, R8 1 (listing also R8-flavored). Weak: `isValidBox` true alone.

### test/core/card-io.test.ts — 241 lines, 2026-05-22, 12 tests / 18 checks
Source: `src/core/card-io.ts` (CardIOError messages at 121, 315, 341, 437; YAML stringify options; positional naming).
- "A pure-frontmatter card (no body) parses cleanly" fields object — W3, R5.
- "A card with a markdown body parses both halves" `fields["title"]`, `fields["body"]` — R5; checks two fields, not the whole value.
- "Positional naming: bare `<type>.card` takes its type from the stem" `card.schema.type` → "doc" — R1 (filename discriminator). Why: yes.
- "Missing type surfaces a clear error" two exact messages (`no schema registered for type "broken"`, `cannot determine card type — filename must match Foo.<type>.card or <type>.card`) — R1+R8.
- "Round-trip: serialize then parse" — R2 (file format) / R5.
- "A long scalar never folds across lines" frontmatter equals `---\ndrive-id: drv-long\ntitle: AAAA…\n---\n` — W2 (names the YAML default-wrap failure mode), R2+R1: dropping `lineWidth: 0` rewrites every long title on disk. Why: yes.
- "Frontmatter-only schemas reject body content" exact message — R1+R8.
- "Unknown frontmatter keys are stripped on load (not rejected)" whole fields object — R1: a `.strict()` edit breaks it. Why: yes (drifted cards still load; lint warns elsewhere).
- "A file whose type matches a CardSchema dispatches to the frontmatter path" `loaded.kind`, `schema.type` — R5.
- "Job cards … `*.intake.job.card` dispatches to `intake-job`" — W2 explicit ("This regressed once when the filename discriminator only read the last dot segment"), R1.
- "A file that isn't a recognized frontmatter card … rejected — no XML fallback" two identical messages — R1 (one), R6 (the second input proves the same branch) + R8.
- "A landmark may carry a body" body present / empty — W3 (plan Track C), R7-ish: it checks that `LandmarkSchema` declares `body`, a schema declaration the parser just honors; the empty-body case is R6.
- Why: yes 6, partly 2, no 4. Weak: none would pass a no-op, but 5 checks are single-field projections.
- Counts: W2 2, W3 10, W5 6 | R1 9, R2 2, R5 5, R6 2, R7 1, R8 4.

### test/core/event-bus.test.ts — 314 lines, 2026-07-09, 9 tests / 17 checks
Source: `src/core/event-bus/core.ts` (`parseRows` sentinel at ~235, generation truncate at 174/190, `NewerEventSchemaError`), `event-bus/schemas.ts`.
- "Every event round-trips through its schema" `Object.keys(samples).toSorted()` equals `Object.keys(eventSchemas).toSorted()`; `failures` → `[]` — R2 (persisted/wire shape; catches a schema stricter than a live payload) and R7-flavored (it checks that zod accepts a sample the test wrote). The `failures → []` is a filter-to-empty, which hides which sample broke.
- "A one-sided answer is valid" two `safeParse` results with `data` — W2 (comment: "Zod v4 treats a bare `z.unknown()` object property as required"), R1.
- "A persisted event reads back byte-identical" `[{id:1, event:"card-created", data:samples["card-created"], createdAt}]` — R2 / R5.
- "readRecent — a bounded tail of one event type" three checks: limit-3 oldest-first slice; other type; empty type — R1 (ordering and type filter; edit: newest-first result or missing WHERE). Why: yes (two paragraphs on why oldest-first).
- "A bad row degrades to a sentinel without breaking its siblings" four rows — R1 (three distinct failure branches) + R8 (`'unknown event name "mystery-event"'`, `"JSON parse failed: SyntaxError"` wording).
- "A generation mismatch truncates persisted rows on open" `readSince(0)` → `[]` — R4. Why: yes.
- "A newer generation on disk refuses to open and keeps its rows" `checkThrows` with the full 4-line message, twice (bus open and `assertEventSchemaNotNewer`), then raw SQL shows rows intact — R4+R3 (prevents deleting a newer engine's events); the message itself is R8; the second `checkThrows` is R6 unless the two code paths can diverge (they can; one is a pre-stop check) so R1 marginal.
- "The same generation on disk reopens with its rows intact" — R1 (guards `>` vs `>=`), partly R6.
- "A legacy DB (no meta row) drops its pre-generation rows" → `[]` — R4.
- Why: yes 8, partly 1. Weak: none.
- Counts: W2 1, W3 16 | R1 6, R2 2, R3 1, R4 3, R5 1, R6 2, R7 1, R8 2.

### test/core/migration-sweep.test.ts — 616 lines, 2026-08-19, 15 tests / ~30 checks (largest migration test)
Source: `src/core/migration-sweep.ts`, `lib/box-maintenance/admission.js`, `migration-repair.ts`. History: ea8e67884, dac6357f6, b02ad194f, e343ba14f, c97fea1ad (2026-09-16/17), cb574a8c2 (10-16) each added examples.
- "A box with nothing pending says nothing and does nothing" `{status:"current", newCommits:0}` — R1 (commit count is the proof of no-op). Second half: quiet sweep returns while work is admitted, via `Promise.race([quiet, 3000ms])` → "current", `boxMaintenanceStatus` → null — W2-ish (describes the drain hang), R1, but a timing race (check.md says prove non-blocking by event order, not a timer).
- "A pending script migration is applied and committed as one unit" `{subject:"Apply migration: annex-config-2026-08", trailer:"migration-sweep", manifestInCommit:true, clean:true}` — R1+R2 (the `Created-By` trailer is read by other writers' tooling; subject wording is R8). "A second sweep is a no-op" → "current" — R6.
- "A procedure migration after an applied script reopens the box" `{status:"needs-procedure", applied:[…], phase:null}` — W2 explicit ("all four local dev boxes, 2026-09-16"), R1.
- "An unattended pass runs a procedure once per human answer" five checks across first/second/third/stale/manual — W3 (b02ad194f, e343ba14f) with W2 flavor; R1 each (runs count, question path index, receipt ref, `closed: "D\t…question.card"`). `carriesOutput`, `recorded`, `namesReceipt` are `includes` projections. Why: yes.
- "A scheduled pass yields to a box in use" child-process holder → `{status:"deferred", holders:["fixture child"], phase:null}`, then "applied"; behind a deploy → holders `["deployment"]` — W3 (c97fea1ad), R1 ×3. Spawns a real child (load-sensitive).
- "A dirty box converges without committing unrelated work" `{status:"applied", untracked:"_content/inbox/Half_Written.doc.card"}` + manifest `includes(PROBE)` — R1.
- "A commit that fails rolls the manifest entry back" → "commit-failed"; `{recorded:false, head:"seed migration manifest"}` — W3/W2, R1+R4; the comment explains the failure mode ("the next sweep would read that line, report the box current, and never retry"). Why: yes.
- "A box with no manifest at all is left alone" → "no-manifest" — R1 (weak-ish: single status string).
- "Partial conversion asks once and lets later migrations proceed" `{status:"attention", applied:2, partial:true, agents:1, calls:3}` then `{status:"attention", questions:1}` — R1; `applied.length` / `questions.length` are lengths (lint now rejects).
- "A joined blocker revokes readiness…" two tests `{status:"no-manifest", phase:"exclusive"}` / `{status:"needs-procedure", phase:"ready"}` — R1 (the two outcomes are the branch). Why: yes.
- "A failed migration never leaves the box closed" `{status:"failed", phase:"exclusive", owner:null, ref:true}` then applied, then null — W2 explicit ("The 2026-09-16 incident"), R1.
- "An owner that lost the box does not commit" `{status:"commit-failed", error:"maintenance ownership lost", repairs:0, recorded:false}` — W3 (dac6357f6), R1 + R8 (error string).
- "A rejected commit retains conversion output across an idempotent retry" `{committed:true, staged:"_content/unrelated.txt", unstaged:"", pendingRef:""}` — W2-ish, R1.
- Why: yes on 13 of 15 tests. Weak: `status`-only checks (2).
- Counts: W2 5, W3 25 | R1 27, R2 1, R4 1, R6 1, R8 2. Note 9 projections use `.includes`/`.length`.

### test/core/card-lint.markdoc-and-husks.test.ts — 637 lines, split out 2026-10-18 (content predates 2026-08-30), 12 tests / 16 checks
Source: `src/core/card-lint/core/lint-cards.ts` (universal Markdoc pass gated by `ownMarkdocValidation`, chat duplicates, absolute-path guard), `filename-attach.ts`, `chat-duplicates.ts`, `lib/absolute-path-check.ts`.
Every check is a whole `lintCardsDispatch` result (`results`, `filesChecked`, `filesWithErrors`, `totalErrors`, `totalWarnings`); the four counts are derived from `results` and are internal R6, cheap.
- "an invalid `{% todo %}` status warns" — W3 (todo-annotation plan Track 1 chunk 2), R1 (warning-first severity is a decision an edit flips) + R8 (Markdoc's own message text `Attribute 'status' must match one of […]. Got 'Done' instead.`).
- "The same attribution holds for a multi-line block" — W2 explicit (`collectTagSpans` used `lines[1]`), R1.
- "A body with a valid `{% todo %}` lints clean" — R1 (false-positive guard) / R6.
- "a body that fails to parse warns, not silently" two Markdoc parser messages — R1 + R8 (third-party wording: a Markdoc upgrade fails this without a bug).
- "Commentary cards don't double-report" one error + one canonical warning — R1 (the `ownMarkdocValidation !== true` gate). Why: yes.
- "Path fields not named `ref` are checked too" two checks (landmark `symbol.src`, figure `entry`, emoji symbol) — W2-ish ("left two real path fields unvalidated"), R1.
- "Media cards: `filename.ref` must be in `attach/` form" — W3, R1+R8 (long remedial message).
- "Chat husks: `session` must be a real engine session id" — R1+R3 (validated "before anything keys on it or joins it into a path"); message embeds zod's `Invalid UUID` (R8).
- "two cards must never claim one chat" two boxes — R1 ×2 (second box guards the index walking all of `_content/chat/**`, an edit that narrows to `web/`). Why: yes.
- "No absolute machine paths" three checks: leak → error R3; extfile `href` exempt W2 ("made every real extfile card unfixably invalid") R1; `/Users/me` placeholder R1.
- "scoped Markdoc tags validate in that type's cards only" — R1.
- "The retired type-specific tags are undefined everywhere" five warnings — R4-flavored (pins the `body-tags-2026-10` migration's outcome); fails only if a tag is re-added, so closer to R5.
- Why: yes on all but one. Weak: none.
- Counts: W2 4, W3 12 | R1 14, R3 2, R4 1, R5 1, R6 1, R8 5.

### test/core/last-audio-pending.test.ts — 662 lines (largest in test/core), 2026-06-11, 23 tests / 26 checks
Source: `src/core/last-audio-pending.ts` (thin wrapper over `createPendingBrowserRequests`; echo-and-verify `fulfill`; `graceMs ?? timeoutMs`), chat last-audio routes, `cli/commands/chat/audio.ts`, `core/audio-question.ts`.
Registry (8 tests):
- "an audio answer resolves the request" `{delivered:"delivered", status:"audio", audio:"RIFFfake", recordedAt, pending:0}` — W3, R5.
- "no answer at all times out" `{status:"timeout"}` — R5 (20 ms real timer).
- "a none answer resolves after the wait window" `{reported:true, status:"none"}` — R1. "audio arriving within the wait window still wins" — R1.
- "production default — a none wait is the request's OWN timeoutMs" `{status:"audio", audio:"late-but-in-window"}` after a real 150 ms `setTimeout` — W2 explicit ("Fix (2026-08) … instant chorus of nones used to cut the requested wait down to 2s"), R1 (edit: restore a fixed default wait). Timing-dependent, contrary to check.md's "never a fixed sleep".
- "all tabs answering none still resolves none at the full window's end" — R6 of the default-wait test.
- "a mismatched or missing echoed messageId is ignored" `{mismatched:"ignored", stale:"ignored", stillPending:1, correct:"delivered", …}` — W3 ("Track 1b, load-bearing"), R1+R3 (wrong tab's audio must not reach the asker).
- "unknown and already-settled ids are refused" `{unknownFulfill:"unknown", unknownNone:false, first:"delivered", second:"unknown", winner:"a"}` — R1.
Routes (10 tests):
- 404 unknown-request, 400 bad-answer, 504 no-client — R2 (the CLI parses these bodies) + R8 (the 504 and no-audio bodies are 200-char prose pinned verbatim; "Invalid input: expected string, received undefined" is zod wording).
- "a staged web recording is answered from disk, without the tab relay" `{status:200, contentType:"audio/wav", payload: startsWith("RIFF").endsWith("AAAABBBB"), messageId, sessionId, relayed:false}` then the miss falls through to relay — W3 (a4ca862de), R1 (`relayed:false` branch) + R2 (WAV bytes, headers).
- "a non-HQ send is found by its finalize emissionId too" — W2 (1837ae7f3 "independent of HQ"), R1.
- "full loop — long-poll answered by a multipart upload" headers `x-recorded-at`, `x-message-text`, `x-message-id`, `x-session-id` + body — R2 (CLI reads these headers). Why: yes.
- "a stale-tab answer with no echoed messageId is ignored, then a correct answer wins" and "an answer with a mismatched messageId is ignored" — R2 for `{ok:false, ignored:true, message:…}` body, otherwise R6 of the registry echo test (same branch, through HTTP) and of each other. The second carries a flake note (2026-10-07) — that is a test-fix, not a code bug.
- "a targeted request where the tab answers none resolves not-available" 404 no-audio — R2+R8.
Helpers (4 tests):
- `missingMessageIdError` two near-identical strings — R8 (R2 for agent-legibility); second is R6.
- `AUDIO_QUESTION_MODEL` → "gemini-3.7-flash" — R5/R8: pins a constant; fails on every model change, catches nothing.
- `audioMimeType` four-entry table incl. `null` — R5 (lookup) with the unknown-extension branch R1-marginal.
- `buildAudioQuestionPrompt` two full prompt texts — R8 (prompt wording); the second (context+transcript sections) is R1-marginal for the optional-section branches.
- Why: yes 14, partly 4, no 5. Weak: model constant.
- Counts: W2 2, W3 20, W5 4 | R1 11, R2 8, R3 1, R5 4, R6 5, R8 8.

## test/shared (3 files)

### test/shared/result.test.ts — 59 lines, 2026-07-06, 3 tests / 6 checks
Source: `src/shared/result.ts` — `ok`, `err`, `okVoid` are three one-line constructors.
- All examples run a test-local `lookup()` built on the constructors: `t.check(found.ok ? found.value : found.error.cause, "HELLO")`, `t.check(missing.ok, false)`, `ensure(true).ok → true`. W1-as-documentation (the file states the convention), but R7: it tests the test's own fixture and union narrowing the compiler already enforces. R5 for the constructors. Why: comments state the convention, not why a value is right (n/a).
- Weak: `missing.ok → false` and `ensure(true).ok → true` would pass against any object with that bit.
- Counts: W1 6 (documentation) | R5 2, R7 4. Weak: 2.

### test/shared/natural-sort.test.ts — 33 lines, 2026-08-02, 2 tests / 2 checks
Source: `src/shared/natural-sort.ts` — one line: `a.localeCompare(b, undefined, { numeric: true })`.
- "Numeric suffixes sort by value" → `["foo-1","foo-2","foo-3","foo-10","foo-20"]` — R1-marginal (edit: drop `numeric: true`) but mostly R7 (tests Intl). Why: yes (states the lexical alternative).
- "Non-numeric names still sort as before, and numbers embedded mid-name work" — R6.
- Counts: W3 2 | R1 1 (marginal, also R7), R6 1.

### test/shared/ref-path.test.ts — 227 lines, 2026-07-30, 19 tests / ~40 checks
Source: `src/shared/ref-path/core.ts` (`parseRef`, `resolveRefPath` = 3-form rule + `nonRoot` + `fenced` + `joinSegments`).
- parseRef: four shapes (path / ?query / #fragment / both) — R1 for the split, R6 for the 4th; "fragment starts at the FIRST #" `notes.md#a?b` → fragment `a?b` — R1 (order of the two `indexOf`s). "bare fragment has an empty path" — R1.
- Form 1 (`/…` ignores fromPath), Form 2 (`attach/…` ×3: file, bare `attach`, nested — third is R6), Form 3 (×3: sibling, `..`, `./` — third R6) — R1.
- "fromPath is treated as a containing file" pair with trailing slash — R1. Why: yes.
- "empty or absent fromPath resolves from the box root" `notes.md` → null — R1+R3 (fence).
- "RefKind — who owns an attach scope" three kinds — R1 (the `attachFormAllowed` switch).
- "mid-path .attach/ is an ordinary directory name" — R1.
- "Escapes fail closed" `../../../../etc/passwd` → null, `..` → null; "A leading slash … `..` still can't climb" `/../etc/passwd`, `attach/../../../escape.txt` — R3; W2 explicit in source ("the frontend did that until 2026-07-30, which silently rendered a different file"). Four checks for two rules: 2 are R6.
- "A .. that stays inside the box is fine" — R1 (over-strict guard).
- "%2e%2e is a LITERAL directory name" — R3, W1 (design decision: decode upstream once).
- "A ref that names nothing fails closed too" `""`, `parseRef("#risks").path`, `"/"` → null — W2 (source: "Those used to resolve to a directory … so `#fragment`-only refs read as valid targets"), R1+R3; third is R6.
- "A ref to an ordinary directory still resolves" — R1.
- "Query and fragment are the caller's to split" — R6 of parseRef + Form 1.
- "The box namespace fence" 5 areas resolve (R1; 4 are R6 of one), 7 non-areas → null (R3; `src`, `node_modules`, `.git`, `package.json`, `AGENTS.md`, `.claude`, unlisted — each a distinct vocabulary entry so defensible, but the fence is one `isInBoxNamespace` call: 5 of 7 are R6). "The fence applies uniformly across all three forms" — R1.
- Why: yes on nearly every check. Weak: none.
- Counts: W1 1, W2 2, W3 ~37 | R1 ~20, R3 ~8, R6 ~12.

## test/lib (3 files)

### test/lib/atomic-write.test.ts — 53 lines, 2026-08-01, 4 tests / 5 checks
Source: `src/lib/atomic-write.ts` (`effectiveMode` stat-or-ENOENT; temp → fsync → rename).
- "Replaces content atomically and leaves no temp siblings" content → `{"v":2}`, `readdirSync(dir)` → `["store.json"]` — R1 (temp cleanup) / R5. The "atomically" claim in the title is not what is checked; crash-safety is untested.
- "An existing target's mode survives a rewrite" `mode & 0o777` → `0o600` — W2 explicit (commit c6fe0ae41 "fix: writeFileAtomic preserves an existing target's mode", "caught by cross-model review, 2026-08-01"), R3 (credential store would loosen to umask), R1.
- "An explicit mode wins" → `0o640` — R1 (precedence) / R6.
- "A brand-new file gets the platform default (not a stat failure)" `existsSync` → true — R1 (the ENOENT branch); weak form (existence only).
- Why: yes (file header). Weak: 1.
- Counts: W2 1, W3 4 | R1 4, R3 1, R5 1, R6 1.

### test/lib/csp.test.ts — 105 lines, 2026-06-30, 6 tests / 9 checks
Source: `src/lib/csp.ts` (`COMMON_DIRECTIVES` + `modeDirectives` + two report directives, joined).
- "Prod is strict" full 14-directive list — R3+R2 (header another system enforces; "don't add one without a verified consumer"). Why: yes.
- "`style-src` keeps 'unsafe-inline'" `prod.split("; ")[1]` — R6 (element of the previous list).
- "Dev relaxes script/style" full dev list — R1 (mode branch) + R3; 12 of 14 lines are R6 of the prod list.
- "Shared directives (both modes)" `slice(2,-2)` of each — R6 ×2 (subsets already pinned).
- "The report directives must be present" `slice(-2)` ×2 — R6 ×2.
- "Reporting-Endpoints companion header" `'csp-endpoint="/api/csp-report"'` — R2 / R5.
- Why: yes (each directive's reason). Weak: none; but 5 of 9 checks are subsets of the first two.
- Counts: W3 9 | R1 1, R2 2, R3 2, R5 1, R6 5.

### test/lib/box-containment.test.ts — 190 lines, 2026-07-05, 11 tests / ~28 checks
Source: `src/lib/box-containment.ts` (`containWithinBox` `=== root || startsWith(root+sep)`; `realpathContained`; `readContainedFile`), `core/ref-exists.ts` `resolveContainedRef`.
- `containWithinBox` inside / root `""` — R5. Normalization `.`/`..`/trailing sep — R1. Escapes ×3 — R3 (2 R6). "Prefix collision" `/box-evil/secret`, `/boxied` → null — R3, W2-flavored (source cites the `resolve-path` CVE and the 2026 `@fastify/static` bug as the reason for hand-rolling). Why: yes ("never a bare startsWith").
- `resolveBoxRelativeRef` ×4 — R3 but R6 of `containWithinBox` (one-line wrapper).
- `resolveContainedRef` three forms + attach — R1; and traversal ×3, `%2e%2e` — R3 but R6 of `test/shared/ref-path.test.ts` which runs the same inputs (`../../../../etc/passwd`, `/../etc/passwd`, `..`, `%2e%2e/x.card`) through the layer underneath.
- "A ?query or #fragment … split off before resolution" — W2 explicit ("used to false-flag `feedback.target.ref`'s documented `path#fragment` form"), R1.
- "readContainedFile — symlink hardening" in-box read; symlink to `/etc/hosts` → `realpathContained` null, `readContainedFile` throws `{name:"RefEscapesBoxError", message:…, relPath}`; legit unchanged; missing target unchanged — W1 (realpath both sides because of macOS `/var`), R3 ×2, R1 (ENOENT branch). Why: yes.
- Weak: none.
- Counts: W1 1, W2 2, W3 ~25 | R1 ~8, R3 ~12, R5 2, R6 ~10 (≈6 of them cross-file with ref-path.test.ts).

## test/schemas (2 files)

### test/schemas/question.test.ts — 356 lines, 2026-07-10, 15 tests / ~35 checks
Source: `src/schemas/question.ts` (`superRefine` at 30–70: ≥2 options, unique ids, case-insensitive labels, no options for text/confirm; `refineQuestionLifecycle`; `IsoDuration`; three template builders), `templates-registry.ts`.
- "select requires at least two options" three `.safeParse(...).success` booleans — R1; the 1-option and 0-option inputs are R6 of each other. Weak form: a boolean hides which issue fired.
- "confirm and text must not carry options" ×3 — R1, one R6.
- "State: read from which lifecycle timestamp" 4-way map → `["pending","answered","dismissed","expired"]` — R1.
- "`answered-by` is gone — stripped, not rejected" `data` object — R4 (old cards on disk keep loading). Why: yes.
- "`learning`: sink/ref/proposal" ×4 — R1 (required proposal; sink excludes `question`); 2 R6.
- "`expires-after`: ISO-8601 duration" 6-entry table — R1 (regex) with W4 flavor; `"30d"`, `P`, `PT` are three rejects for one pattern.
- "`asked-at`: ISO datetime with offset" ×2 — R7 (zod's `datetime({offset:true})`).
- Select / text / confirm templates `checkText` full card — R2 (card file format) + R8 (key order). Confirm is R6 of select.
- "Option uniqueness: ids unique, labels unique case-insensitively" ×3 — W3 (commit 991c2609e "schema coherence, option uniqueness"), R1. Why: yes ("Answer resolution matches … with toLowerCase()").
- "Lifecycle coherence" 6 checks — R1 (three distinct rules), 2 R6; last pins the issue message `"expired-at" must not appear with "dismissed-at"` R8.
- Registry templates `question-text`, `question` via `argsSchema.parse` — R1 (passthrough through the args schema; commit 504c2ba94 fixed a registration regression here → W2 adjacent) but the card text is R6 of the builder tests above. "Strict arg validation" `checkThrows … "ZodError"` ×2 — R1.
- Why: yes 7, partly 4, no 4. Weak: 15 `.success` booleans.
- Counts: W2 1, W3 ~30, W4 1 | R1 ~20, R2 3, R4 1, R6 ~8, R7 2, R8 4.

### test/schemas.test.ts — 226 lines, 2026-03-03, 12 tests / 13 checks
Source: `src/schemas.ts` `getCardTypes`, `templates-registry.ts`, `schemas/intake-job.ts`, `webpage.ts`, `figure.ts`.
- "The registry tracks all known card types" `[…].filter(not included)` → `[]` — R5; filter-to-empty hides which type vanished.
- "Looking a template up … is sufficient to have every built-in registered" `getTemplate("doc")?.name` → "doc"; `getDefaultTemplate("recipe")` → undefined — W2 (commits 504c2ba94, d776c3511: registration regression after the barrel removal), R1 (edit: reintroduce a side-effect import requirement). The `recipe → undefined` half is R5/R8 (pins an absence).
- "A select question presents options" full card text — R6: byte-identical to the select-template check in `test/schemas/question.test.ts`.
- Intake job ×2 (default priority; `connector` + `low`) — R2 (job-card format the reactor reads) + R8 (key order); the second is R1 for the optional `connector` line.
- Webpage ×2 — R2; second R1 (optional `siteName`/`frozen` emitted only when set).
- Figure `safeParse(...).success` → true; missing `entry` → false — R7 (zod required field) / R5.
- Figure template p5js text — R2+R8. Canvas-loop params text — W2 ("`size` … warning on every mount"), R1.
- "The generated card validates against the schema" `parsed.fields.runtime` → "three" — R1 (template/schema agreement) but a weak projection (the parse not throwing is the claim; one field is checked).
- Why: yes 5, partly 3, no 4. Weak: 2.
- Counts: W2 2, W3 11 | R1 5, R2 5, R5 3, R6 1, R7 1, R8 3.

## Overall tallies (18 files, ~290 checks; counts are per example/group, approximate)

Axis W: W1 ~8 (3%) · W2 ~34 (12%) · W3 ~230 (80%) · W4 ~2 · W5 ~17 (6%).
- W2 is concentrated: migration-sweep (5), malformed-question (4), card-lint (4), card-io (2), ref-path (2), box-containment (2), last-audio (2), schemas.test (2), atomic-write (1), event-bus (1). Every W2 example names a date, commit, incident, or "used to".
- W3 is the default: most tests were written alongside the feature and the comment cites a plan/track.

Axis R (primary code; secondary codes counted too): R1 ~145 (50%) · R2 ~27 (9%) · R3 ~27 (9%) · R4 ~13 (4%) · R5 ~32 (11%) · R6 ~50 (17%) · R7 ~10 (3%) · R8 ~30 (10%).
- Why-comment present: yes ~65%, partly ~15%, no ~20%. "No" clusters on R5 examples (nothing to explain) and on list-pinning (box dirs, CSP).
- Weak examples (would pass a no-op or the obvious wrong thing, or check only a bit/length/existence): ~25, mainly `.success` booleans (question.test.ts, schemas.test.ts), `.includes`/`.length` projections (migration-sweep, box.test.ts), `existsSync`, and one same-source fixture (engine-version test 1).

## Observations

1. W2 and R1 co-occur almost perfectly, and W2 examples carry the best comments. Every bug-pin names the symptom and the edit that would reintroduce it (`migration-sweep` "The 2026-09-16 incident", `card-lint` `lines[1]`, `atomic-write` 0600, `last-audio` "Fix (2026-08)", `card-io` "regressed once when the filename discriminator…"). Tests written to a plan (W3) range from R1 to R5 depending on whether the plan item was a rule or a straight-line value.

2. R6 is mostly cross-file or cross-layer, which a per-file review misses. `box-containment.test.ts` re-runs `ref-path.test.ts`'s traversal inputs through `resolveContainedRef`; `schemas.test.ts` duplicates `question.test.ts`'s select-template text byte for byte; `last-audio-pending` proves echo-and-verify once in the registry and twice more through HTTP; `csp.test.ts` checks subsets of lists it already pinned whole. Within a file, R6 appears as a third or fourth input to the same branch (ref-path namespace fence: 5 areas, 7 non-areas, one `isInBoxNamespace` call).

3. R8 is dominated by third-party wording embedded in user-facing messages: zod (`Invalid input: expected string, received undefined`, `Invalid UUID`), Markdoc (`Expected "(" but end of input found.`, `Attribute 'status' must match one of […]`), plus two 200-character prose bodies in last-audio and a model-name constant (`AUDIO_QUESTION_MODEL`). These fail on a dependency upgrade or a copy edit, not on a bug. Where the message is the contract another tool parses (`error: "no-client"`, trailer `Created-By`), the code half is R2 and only the prose half is R8.

4. Size does not predict R5/R6 share; kind does. The two largest core files are mostly R1: `migration-sweep` (27 of ~30) grew one example per incident; `card-lint.markdoc-and-husks` (14 of 16) is one rule per check with whole-result values. The largest-by-lines `last-audio-pending` has the highest R6+R8 share among big files because it re-proves registry rules through routes and pins message prose. The highest R5/R7 share is in small "convention documentation" files (`result.test.ts` 100%, `natural-sort` R7/R6, `geo` 3 of 5, `engine-version` 3 of 5).

5. Newer tests are tighter. The 2026-10-22 `migration-repair.malformed-question` is 4 checks, all W2+R1, each a composed whole-value object with a why-comment. The 2026-03 files (`box.test.ts`, `schemas.test.ts`) have the most R5 and projection checks (`includes`, `?.name`, filter-to-empty) and least why-text. The 2026-10-08 "Test cleanup" and 10-16 "Typecheck doctests" passes trimmed but did not remove R5/R6 (e.g. `schemas.test.ts` still has the duplicated select template).

6. Projections that lint now rejects persist in converted doctests: `.success` booleans (≈15 in `question.test.ts`), `.length` (`migration-sweep` partial conversion), `.includes` on manifests and `.gitignore`, `existsSync`. They are not wrong, but each hides the value a failure would show, and several (`isValidBox → true`, `ensure(true).ok → true`, `listBoxCardFiles → []` alone) pass a no-op.

7. Timing and real processes appear in otherwise strong tests: `last-audio` 150 ms real sleep to prove "late but in window", `migration-sweep` `Promise.race` with a 3 s timer to prove the quiet path does not drain, a spawned child holder for `--yield`. check.md's own guidance (prove non-blocking by event order) is not followed in those two.

8. The exhaustive-enumeration style earns its keep only in R3 files (`ref-path`, `box-containment`, `csp`, `atomic-write` mode): the many inputs are the security claim. The same style in non-security files (`csp` subsets aside, `geo` far-away/zero, `engine-version` third comparison, `question` three rejects for one regex) adds R5/R6 without a new claim.

9. Whole-value result objects (card-lint's `{results, filesChecked, filesWithErrors, totalErrors, totalWarnings}`) make one check prove a rule and its absence of side effects at once; the derived counts are internal redundancy but cost nothing and make a wrong-severity edit visible. That form, plus a why-comment and a fixed clock, is the pattern the W2+R1 examples share.
