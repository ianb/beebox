# User-story audit — follow-up plans

**Status:** implemented 2026-06 — buckets A–C done; bucket D partially done (see body)

This plan triages the 95 `IAN:` comments left on `docs/reports/user-stories-audit-2026-06-26.md` (the
auto-generated user-story catalog). Each comment was investigated against the
**current** code by a read-only agent, classified, and given a concrete action
grounded in real file paths.

Four buckets, matching the maintainer's framing:

- **A — Removals.** Features that were partially removed; the leftover
  pages/components/endpoints are cleanup debt.
- **B — Doc-only corrections.** The code is right; the *story* (or a real doc)
  is wrong. Mostly fixing file citations and over-claims in `user-stories-audit-2026-06-26.md`.
- **C — Small fixes.** Real, narrow bugs with a known file and change.
- **D — Substantial features.** Missing capability that needs design + build.

Item numbers (`[n]`) refer to the order in `user-stories-audit-2026-06-26.md`; they're kept so
every comment is traceable back to its story.

## Implementation status (2026-06-26)

- **Bucket A — done (incl. A4).** A1–A3, A5–A8 removed bookmark/share, web-UI
  command buttons, voice/text memos, the dead `transcribe()` method, the
  `@version`/`#fragment` ref parsing, the dead Drive `inspect` endpoint, and
  `cb prompt`. **A4** (maintainer chose: remove, keep a log/summary) removed the
  calendar-review job card + schema + review-only `SyncNote` plumbing; the
  narrative sync commit message is the change log. Stories [34],[35] deleted;
  [29] reframed to "changes in the sync commit"; [38] kept (X-CB-DELETE) minus
  the review-job mention.
- **Bucket B — done.** 44 doc corrections + item [47] reframed to TTS-only +
  `docs/calendar.md` updated ([46]).
- **Bucket C — done.** All small fixes applied (see C section). Notable: [67]
  needed no change (tRPC `wsLink` already resumes via `tracked()`); [58] was the
  web wakeup trigger — removed (agent-managed now), story deleted; [92] resume
  is a maintainer WONTFIX, story deleted. [40]'s batching change also affects the
  full-wakeup path (one job file per source instead of per batch) — flagged as a
  possible trade-off. [69] (model-switch) is **deferred** — it needs a live
  Claude invocation to test, not an automated test.
- **Catalog:** 413 → **400 stories**; all `IAN:` annotations cleared — the
  unbuilt bucket-D features are now parked as the backlog in `docs/ideas.md`
  ("User-story audit — remaining feature backlog"), so the catalog reads as a
  clean reference doc.
- **Bucket D — partially done:**
  - **D7 (calendar remote-conflict) — built.** `EventFileEntry` now stores the
    remote `updated` timestamp; on a local edit, if the remote also changed since
    last pull, remote wins (local edit discarded + warning), else push as before.
  - **D11 (ref-attribute normalization) — built.** `procedure-ref` (landmark) and
    `frozen` (webpage + commentary) were bare-string refs not under a `ref` key;
    normalized to `<field>: { ref: … }`, which makes `walkForRefs` + `cb mv`
    rewriting work automatically. Migrator `scripts/migrate/normalize-ref-keys.ts`
    added and **registered in `src/core/migrations.ts`**, so `cb migrate --apply`
    picks it up per box (manifest-tracked) — no manual per-box invocation.
    (`question-ref` left as-is: its ref already lives under a `ref` key, so it's
    compliant; `template-ref` is a `${…}` substitution pattern, not a card ref.)
  - **D4 (PDF) — design only.** `docs/plans/pdf-intake-design.md` reviewed and its
    card-shape examples refreshed to YAML; build deferred.
  - **D8 (Docs/Sheets comments → sidecar)** and **D9 (Drive mounting/browsing)** —
    parked as entries in `docs/ideas.md`.
  - **Remaining (unstarted):** D1 questions overhaul, D2 todo multi-state, D3
    frontmatter write, D5 procedure validation, D6 retrospective integration, D10
    asset-manifest completion, plus deferred [69] model-switch verification — all
    parked in `docs/ideas.md` ("User-story audit — remaining feature backlog").

## Summary

| Bucket | Count | Items |
|---|---:|---|
| A — Removals | 11 | 2, 4, 5, 6, 7, 24, 34, 47, 63, 71, 79 |
| B — Doc corrections | 45 | 3*, 8, 14, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 29, 30, 33, 38, 41, 42, 45, 46, 49, 50, 53, 54, 56, 57, 59, 60, 61, 62, 66, 72, 73, 74, 75, 76, 78, 80, 81, 84, 87, 90, 93, 95 |
| C — Small fixes | 25 | 1, 3, 13, 31, 32, 35, 36, 37, 40, 43, 52, 55, 58, 67, 68, 69, 70, 77, 82, 83, 85, 88, 89, 91, 92 |
| D — Features | 15 | 9, 10, 11, 12, 15, 16, 28, 39, 44, 48, 51, 64, 65, 86, 94 |

\* A few items appear in two buckets where the fix is small but also needs a doc
note; the detailed section is authoritative.

**Recommended order.** B (cheap, removes noise from the catalog) → A (cleanup,
prevents the dead code from misleading future audits) → C (real bugs, several
are user-visible) → D (pick by priority; most are independent).

---

## A — Removals (partially-removed / dead features)

### A1. Bookmark / "share to box" target — *remove* — items [2], [7]
The PWA share-target UI is fully built and renders, but the `bookmark` card
schema it depends on was deleted (no `BookmarkSchema` in
`src/schemas/registry.ts`), so every save errors out. The live-app browser pass
confirmed this end-to-end.

- Delete `src/frontend/src/pages/SharePage.tsx`, `useShareNote.ts`,
  `share-save.ts`, `share-params.ts` (voice-note-during-share dies with it — [7]).
- Remove the route that mounts `SharePage` (App router) and the PWA
  share-target manifest entry.
- Grep for any remaining `bookmark` references and remove them.
- **Effort:** small.

### A2. Bare box-commands in the web UI — *remove* — items [4], [5]
Early experiment to expose `wakeup`/`sync` through the dashboard. The agent now
runs these exclusively. The buttons are also broken (`ActionModal.tsx:36` runs
`"sync"`, but only `"connector-sync"` is registered).

- Remove the `sync`/`wakeup` actions from
  `src/frontend/src/components/dashboard/ActionModal.tsx` and `HeaderStrip.tsx`.
- If `CommandRunner.tsx` is then unused, delete it and its SSE command route.
- **Caution:** confirm nothing else mounts `CommandRunner` before deleting.
- **Effort:** small.

### A3. Voice & text memos — *remove* — items [6], [47]
Memos were superseded by chat capture. `NewMemo.tsx` still tries to create an
unregistered `voice-memo` card type.

- Delete `src/frontend/src/components/NewMemo.tsx` and
  `NewMemo-VoiceRecorder.tsx`; remove the `create-memo` case from `ActionModal.tsx`.
- Remove the dead `transcribe()` method from `src/services/openai-audio.ts`
  (lines 27-31) and its fake (production transcription goes through
  `src/core/transcription.ts:transcribeAudioWhisper()`, not the service) — [47].
  TTS in that service is live; keep it.
- **Effort:** small.

### A4. Calendar-review job cards — *remove (decide first)* — items [29], [34], [35], [38]
The calendar-review job is created **after** sync commits
(`src/connectors/google-calendar.ts:216-224`) — it's post-hoc, informational,
and has no approval/reject gate. IAN: reporting/logging is enough; a review job
card isn't warranted. Deletions ([38]) and the "priority" enum ([35]) are all
downstream of this.

- **Decision needed:** keep a summary in the commit message / a lightweight
  log, or a single rolling summary card — but drop the per-sync review job.
- Then: delete the job creation (`google-calendar.ts:216-224`), the
  `src/schemas/calendar-review-job.tsx` schema, and references. The "prioritized"
  enum question ([35]) and the X-CB-DELETE "no review needed" note ([38])
  resolve automatically.
- Item [29] becomes a doc fix if any review concept remains.
- **Effort:** medium. **Cross-cutting** with D7 (remote-conflict), which is the
  one piece of calendar-change handling worth *building* rather than removing.

### A5. Reference versioning / anchor syntax — *remove* — item [24]
`src/core/ref-exists.ts:40-46` parses/strips `@version` and `#fragment` suffixes
for old-XML-loader back-compat, but nothing retrieves historical versions or
resolves anchors. IAN wants versioning stripped everywhere.

- Remove the `@version`/`#fragment` parsing from `ref-exists.ts` and any ref
  resolver that mirrors it; delete the story.
- Verify no caller depends on the parse before removing.
- **Effort:** small (but grep carefully — refs are load-bearing).

### A6. Dead Drive `inspect` endpoint — *remove* — item [63]
`src/webapp/trpc/routers/drive.ts:47-79` `inspect` procedure is never called by
any frontend code (verified by grep). Folds into the Drive-UI decision (D9): if
we don't build the browse UI, delete it; if we do, wire it in.

- **Effort:** trivial to delete.

### A7. `cb prompt` interactive command — *remove* — item [79]
`src/cli/commands/prompt.ts` is a one-shot runner the story mislabels as
"interactive." IAN: not needed at all.

- Remove `src/cli/commands/prompt.ts`, unregister from `src/cli/index.ts`,
  delete the story.
- **Effort:** small.

### A8. "No new user stories identified" — *remove* — item [71]
A meta-narrative the discovery pass emitted, not a story. Delete it from the
catalog. **Effort:** trivial.

---

## B — Doc-only corrections

The code behaves correctly; the catalog (or, where noted, a real doc) is wrong.
Most are one-line edits to `docs/reports/user-stories-audit-2026-06-26.md`. Batch them in a single pass.

**Wrong file citations** (replace the cited file, no behavior change):
[14] drop `list-cards.ts` (unrelated to dotted-path query) ·
[19] cite `src/cli/commands/ls.ts`, not `create.ts` ·
[21] speech-segment files are `lib/speech-parsing.ts`, `lib/tts-client.ts`,
`components/chat/SpeechChunk.tsx`, `machines/speechPlaybackMachine.ts`,
`routes/chat-audio-routes.ts` (not `chat-session-messages.ts`) ·
[23] cite `chat-session-pool.ts`, not `chat-reactor-sessions.ts` ·
[27] drop `chat-turn-marker.ts` (that's `whats-changed`, not streaming) ·
[45] OAuth flow lives in `src/cli/commands/google-auth.ts` ·
[62] scheduler history isn't `history.ts` ·
[95] renderer is `concept-map.tsx`, not `concept-map-renderer.tsx`.

**Over-claims to soften** (behavior is narrower/by-design than the story says):
[8] calendar toggle is correct but auth-gated — the error message is expected;
optionally improve copy ·
[17] audio *analysis* is Gemini, not Claude (Claude has no audio input) ·
[18] only the schemas guide uses the template tracker; tricks/views are
create-if-missing ·
[20] chat sessions are sequential with rotation, not concurrent (latency is the
trade-off) ·
[22] commit-discipline uses a `Fallback` trailer, not a git tag ·
[25] narration mode lives in the debug menu by design ·
[26] schedules are one-time, not recurring (note `in=`, not `delay=`) ·
[29] calendar review is post-hoc reporting (see A4) ·
[30] lossy detection is warning-only; no manual merge/preserve ·
[33] calendar remote-wins-after-failed-push already holds (build is D7) ·
[38] X-CB-DELETE is immediate deletion + post-hoc log ·
[41] callback timers are agent-controlled — reframe "As an agent" ·
[42] backlog skip on first sync is automatic and fine ·
[46] update `docs/calendar.md`: bidirectional sync *is* implemented, auto-sync
off by default, push path untested ·
[49] events are created by editing/agent-writing `.ics` files, no UI ·
[50] / [53] Telegram webhook filtering is hardcoded to `message`/`edited_message`
by design ·
[54] TTS tone via agent `<instructions>` tags; no user UI ·
[56] Drive view is read-only listing (build is D9) ·
[57] images are inline attachments; files upload separately and are referenced
by path ·
[59] diarization is opt-in via `hqService: "voxtral-diarized"`, not automatic ·
[60] `publicUrl` is deployment-set, read-only ·
[61] model switch restarts the subprocess but preserves context ·
[66] frozen snapshots intentionally hot-link images (size) ·
[72] whisper is HQ-batch only; realtime falls back to Voxtral/Deepgram/OpenAI ·
[73] / [75] / [81] reframe as agent abilities, not user features ·
[74] Sheets sync as JSON, Docs as markdown ·
[76] reactor source-filtering is internal by design ·
[78] health has 6 statuses (add `invalid`) ·
[80] daemon needs a manual `launchctl load` (or see C/[88]) ·
[84] `cb extfile sync` is intentionally manual ·
[87] PostToolUse validates card links/integrity, not general markdown ·
[90] `cb render` (app pages, scenario override) vs `cb view test` (agent views)
are separate ·
[93] todo template is a flat skeleton; nested/notes via manual edit (controls
are D2).

**Effort:** the whole bucket is ~1-2 hours of editing `user-stories-audit-2026-06-26.md` plus a
small `docs/calendar.md` update ([46]).

---

## C — Small fixes (real bugs)

Grouped; each is a contained change.

**Cross-cutting clusters:**

- **Outbound connectors only init Telegram** — items [77], [85].
  `src/cli/commands/finalize.ts:24` calls only `createTelegramConnector()`;
  `wakeup-connectors.ts:28-31` initializes Gmail/Calendar/Telegram/Drive. Add the
  three missing initializers (+ imports) to `finalize.ts`. IAN: "oh yeah, that's
  not good." **Small.**
- **Asset manifest never runs on commit** — items [13], [82] (see also D10).
  Verification code exists but the pre-commit hook
  (`src/core/install-validation-hooks.ts:68`) only runs `cb validate --staged`.
  Add `cb attachments verify` (and optionally auto-claim) as a hook stage.
  **Small.**
- **Person cards aren't committed / never updated** — items [32], [36].
  `updatePersonEntry()` (`src/connectors/chat-utils.ts:267-274`) writes a
  one-time skeleton, doesn't stage it, and never updates it. Return the card
  path so callers stage it ([36]); add an opt-in `force` update that refreshes
  Telegram metadata (name/username/ids) without clobbering agent-owned fields
  ([32]). **Small–medium.**

**Standalone fixes:**

- [1] **Questions answer bug.** `QuestionForm.tsx` sends a letter code
  (`String.fromCodePoint(97+index)`) that `answer.ts` stores verbatim instead of
  resolving to the option id; confirm-type questions render as a textarea
  instead of radios. Fix the id round-trip and inject default options for
  confirm questions. IAN flags Questions as bug-prone generally — see D-note.
  **Small.**
- [3] **File viewer extensions.** Add `.pdf` + image extensions to
  `FILE_EXTENSIONS` in `ViewPage.tsx:17` so they route to `FileView`. (Drop
  `.xls` — we can't view it.) **Trivial.**
- [31]/[37] **Google Docs lossy "drawings".** The `drawings` count is always 0;
  IAN says the images-vs-drawings split doesn't matter. Remove the `drawings`
  field from `LossyCounts` and `gdoc.tsx`. **Small.**
- [35] **Calendar priority enum** — resolved by A4 (drop review jobs). If review
  stays, add `"high"` to the enum and use it for urgent events.
- [40] **Intake batching on wakeup.** Wakeup calls `createNewIntakeJob()` (never
  appends); switch `wakeup-steps.ts` to `createOrAppendIntakeJob()` so
  connector intake batches by source. **Small.**
- [43] **Lossy suggestion/table counts** count all, not just unresolved/complex.
  Filter by resolved status / structural complexity in
  `drive-handler-docs.ts:73-106`. **Medium.** (Lower priority than [44]/D8.)
- [52] **Calendar delete idempotency.** `google-calendar.ts:131-141` catches
  HTTP 410, but the API returns 404 for already-deleted events → second delete
  throws. Check 404; add a double-delete test. **Small.**
- [55] **Calendar sync window UI.** Backend `updateConfig` accepts
  `syncDaysBack`/`syncDaysForward`; `CalendarSection.tsx` has no inputs. Add the
  fields. **Small.**
- [58] **Web "wakeup" only syncs connectors.** `actions.ts` runs
  `connector-sync`, missing the reactor step the CLI `wakeup` runs. Either run
  the full cycle or add the reactor step. **Medium.** (Note: A2 removes the
  *manual command buttons*; this is the legit "trigger wakeup" action — keep but
  complete it, or fold into agent-only. Decide alongside A2.)
- [67] **Event resumption is server-only.** Server tracks/replays by event id,
  but the client never stores/sends `lastEventId` on reconnect. Persist and
  resubmit it in `useBusSubscription` / `chat.turnStream`. **Small.**
- [68] **Box-boundary checks are inconsistent.** `api-files.ts:104` is correct,
  but `api-browse.ts:45` and `api-files-write.ts:49` use a weak `startsWith`
  (sibling-dir escape) and `views.ts:32` has *no* check (path traversal).
  Standardize on `resolved !== root && !resolved.startsWith(root + sep)`. IAN
  notes real enforcement belongs in the container, but these are cheap and worth
  closing. **Small, security-relevant.**
- [69] **Model-switch is untested.** Mid-conversation model switching
  (`chat-session-routes.ts:175-206`) has zero test coverage and recent
  "model-picker desync" fixes suggest it was flaky. IAN: worth testing, but not
  an automated test — it needs a real Claude invocation. Add a manual/integration
  check (drive a session, switch models, confirm context survives) and fix any
  desync found. **Medium (verification).** Relates to the model-selection cluster
  ([59], [61], [72]).
- [70] **Dedup map is in-memory.** A server restart between send and retry
  duplicates the message. Persist dedup state (e.g. `box/tmp/message-dedup.json`)
  with TTL cleanup. **Small.**
- [83] **CLI feedback exits 1.** `feedback.ts:153` `process.exit(1)` on error
  interrupts the agent's task; write a non-blocking stderr note instead. **Small.**
- [88] **Scheduler daemon manual load.** Optionally auto-run `launchctl load`
  after writing the plist (or `--auto-load`). IAN: nice-to-have if instructions
  are clear. **Small.**
- [89] **Health doesn't show running tasks.** `loadRunningScripts()` exists but
  the CLI `health` command doesn't call it. Surface running PIDs/locks. **Medium.**
- [91] **Re-transcribe word timestamps.** `chat-audio.ts:310` doesn't pass
  `{ wordTimestamps: true }`; infra supports it. Add a `--timestamps` flag that
  writes timing to a sidecar file. **Small.**
- [92] **Scenario checkpoint resume** doesn't restore git state — it skips steps
  but never checks out the checkpoint tag, so resumed runs start from clean main.
  IAN: resuming mid-test isn't useful/important — **likely WONTFIX / drop the
  story** rather than fix. Confirm before deleting.

---

## D — Substantial features (design + build)

Each is roughly independent; pick by priority. The bigger ones deserve their own
`docs/plans/` doc and possibly a dedicated worktree.

### D1. Questions, end-to-end — items [1] (+ maintainer note)
IAN: "Questions probably have a bunch of bugs… a feature I want but haven't
implemented well." [1] is the concrete bug; the broader ask is a **focused audit
+ rebuild of the questions flow** (creation by agents/triage, the answer schema,
the form's type-switching, and answer round-trip). Recommend a small dedicated
plan that uses the user-story method on just the questions subsystem. **Medium.**

### D2. Todo multi-state controls — item [9]
`TodoListView.tsx` only toggles pending↔done; the schema + backend already
support `cancelled` and `deferred`. Replace the binary control with a
4-state control (dropdown / context menu). IAN: "valid issue, may need design."
**Medium.**

### D3. Frontmatter dotted-path *write* — item [11] — RESOLVED (won't build)
Only `lookupField()` (read) exists, by design. IAN confirmed no write API was
intended; resolved as the doc fix — the over-claiming user story now describes
the read-only capability. No `setField()`: there's no caller, and card mutations
go through parse-mutate-reserialize. Dropped.

### D4. PDF / document analysis — item [15]
PDFs are filed verbatim with no ML analysis
(`src/core/commands/scan-import-document.ts`). IAN: "a whole task on its own,
maybe docling." **There is already `docs/plans/pdf-intake-design.md`** — fold
this item into that plan rather than starting fresh; check it's current. **Large.**

### D5. Procedure validation completion — items [16], [94]
`engine-phase.ts:91-109` stubs instruction-based validation (always passes) and
downgrades `severity: review` retry to a warning. Build: (1) model-evaluated
instruction validation against git diff + box state; (2) `review`-severity
auto-retry with failure context; (3) resumable runs from a failed step ([16]).
**Large.** Its own plan.

### D6. Retrospective integration — item [28]
Scan/observation discovery works, but integration is a manual procedure template
and the report writes "_Pending integration._". Build `src/core/retro/integrate.ts`
to auto-apply low-stakes observations to personality/guide cards and raise
question cards for high-stakes ones; finalize the report; retire the manual
procedure. IAN: "missing feature — analysis must end with integration." **Large.**

### D7. Calendar remote-conflict resolution — items [33], [39]
Today only *local* edits are detected (content hash); no remote etag/timestamp
is tracked, so a remote change since last pull is silently overwritten. Build:
store `remoteRevisionId`/`remoteModifiedTime` in `EventFileEntry`
(`google-calendar-state.ts`), and before pushing a local edit, detect a remote
change → **remote wins + warn/log** (IAN's stated policy). Pairs with A4 (this is
the calendar-change handling worth building; the review-job is the part to drop).
**Large.**

### D8. Google Docs/Sheets comments → sidecar — items [44], [48], [51] (+ [30], [37], [43])
`listComments()` fetches full comment objects, but only the *count* is kept as a
lossy warning; Sheets never fetch comments at all. Build a sidecar attachment
(e.g. `.comments.json` / `.comments.md`) storing content, author, timestamp,
resolved status, with a link upstream; reference it from the gdoc/sheet card.
IAN: "preserve these in a sidecar." The lossy-detection cleanups [30]/[37]/[43]
live in the same files and can ride along. **Large.** Own plan.

### D9. Google Drive mounting / browsing UI — items [55], [56], [63], [64], [65]
The backend `updateConfig`/`available`/`inspect` tRPC procedures exist but **no
UI or CLI calls them** (`DriveSection.tsx` is read-only; the documented "CLI
mount" command doesn't exist). IAN: "browsing and selecting files is a whole
thing… I haven't experimented with Drive mounting at all." Build either a
`cb drive mount <folder> <path>` CLI (smaller) or a folder-browser UI that calls
`updateConfig` (bigger). Resolve the dead `inspect` endpoint (A6) as part of
this. **Medium–large.** Own plan.

### D10. Asset-manifest completion — items [10], [12], [13], [82]
Core hashing/verify/migrate works via CLI, but: not wired into the pre-commit
hook (no auto-claim/verify on commit — [12]/[13]/[82]), the design doc still says
"not implemented," "versioning" is claimed but only current state is tracked, and
there's no dedup or explicit attach API. Decide the real scope (probably:
pre-commit auto-claim+verify, drop the "versioning"/"dedup" language), then
implement. **Medium** for the hook integration; **large** if dedup/attach API is
in scope.

### D11. Ref-attribute normalization + complete move-rewrite — item [86]
`rewrite-card-refs.ts:159` only rewrites `ref:`/`refs:`, missing `procedure-ref`,
`template-ref`, `question-ref` (so card moves leave dangling landmark refs).
IAN's rule: **every card reference must live under a key named exactly `ref`**
(e.g. `procedure: {ref: <loc>}`). Two-part: (1) audit `src/schemas/` for
ref-bearing keys not named `ref`, rename them (+ migrate existing cards);
(2) update `rewrite-card-refs.ts` to follow the normalized structure and cover
landmark cards in move/rename. **Large** (schema change + migration). Own plan.

---

## Open decisions for the maintainer

1. **A4 vs D7 — calendar changes.** Confirm: drop the review-job card, keep only
   a log/summary, and build remote-conflict detection (remote wins + warn)?
2. **[58]/A2 — web "wakeup".** Remove all command buttons (agent-only), or keep a
   single proper "run wakeup" action and complete it (add the reactor step)?
3. **D3 — frontmatter write.** Wanted feature, or just a doc over-claim to fix?
4. **[92] — scenario resume.** Drop the story (WONTFIX) as IAN suggested, or fix?
5. **D-priorities.** Which of D4–D11 are worth spinning into their own plans/
   worktrees now vs. parking?
