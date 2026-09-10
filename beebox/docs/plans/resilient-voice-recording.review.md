# Cross-model review — resilient-voice-recording (round 1)

Reviewer: Codex (`gpt-5.5`, reasoning effort high, read-only), 2026-09-10,
plan mode with the challenge persona. The plan author verified each finding
against source. Adjudication and the resulting plan change are recorded per
finding.

## Findings

### 1. Closed-tab recovery contradicts the job story
**Claim:** Track 2 said the queue outlives "a closed tab". Failure modes
accepted that a closed tab loses the message. Pending sends are per-tab
`sessionStorage` (`pending-sends.ts:1-4`).
**Verified:** yes.
**Adjudication:** accepted.
- The prose now separates uploads (durable) from the send handoff (not
  durable).
- The remedy is a product call: Open design question 1 (server backstop
  delivery, lean) awaits the boxholder.

### 2. A late correction can be lost when the target chat is busy
**Claim:** `deliverUserMessage` enqueues in memory when busy
(`deliver-user-message.ts:182-186`). Capture counts that as delivered and
accepts a crash loss (`prepare.ts`, the `finishDelivery` comment).
**Verified:** yes.
**Adjudication:** accepted and fixed in plan.
- The handoff stays `delivering` until the landed probe confirms.
- The probe re-runs on resume and on each sweep tick.

### 3. Reload auto-resume crosses "No load path sends anything"
**Claim:** Track 4 resumed `awaitHq` on reload, which could auto-send.
`pending-sends.ts:1-4` forbids sends from a load path.
**Verified:** yes.
**Adjudication:** accepted.
- Reload now shows a visible pending item and never sends.
- Completion is folded into Open design question 1.

### 4. `recordingLocal` is not only a machine state
**Claim:** the hook special-cases segment states by name at `:145`,
`:297-306`, `:398`, `:422`, `:460` and `:483`.
**Verified:** yes.
**Adjudication:** accepted and fixed in plan. One `segmentCapturing(state)`
predicate now serves every check, and it gets a doctest.

### 5. Finalize can race missing chunks
**Claim:** uploads are refused once not `open` (`capture-upload.ts:51-55`), so
a chunk after the seal is lost and HQ runs on partial audio.
**Verified:** yes.
**Adjudication:** accepted and fixed in plan.
- Finalize carries `chunkCount` and refuses a gap with 409 `missing-chunks`.
- This is a request parameter, not manifest state, so it needs no human
  decision.

### 6. iOS "reuse the capture queue" is under-specified
**Claim:** `CaptureStore` validates audio as `.m4aAAC` only (`:499-501`),
there is no PCM format case (`CaptureModels.swift:61-64`), filenames are fixed
to `.m4a`, and retry is 4 attempts (`CaptureStore.swift:15`).
**Verified:** yes.
**Adjudication:** accepted and fixed in plan. Track 6 now specifies a new
native voice-staging store sharing only the background session and HTTP
classification.

### 7. Speaker letters per piece contradict the current agent guidance
**Claim:** `prompts.ts:58` ties a letter to a recording. Per-piece letters
would tell the agent that one conversation's speakers are unrelated.
**Verified:** yes.
**Adjudication:** accepted. This is a transcript-vocabulary decision: Open
design question 2 (lean: fresh letters, a part marker, one prompt sentence).

### 8. The `corrects` landed probe is not free reuse
**Claim:** `userMessageAlreadyLanded` takes a `docPath`
(`deliver-user-message.ts:55-70`).
**Verified:** yes.
**Adjudication:** accepted and fixed in plan.
- The parameter generalizes to `marker`. Voice passes the recording id, which
  appears in the transcript only as the correction's `message-id`.
- A related citation error was also fixed: the plan said to *extract*
  `deliverUserMessage`, but it already exists and is shared by capture and
  bulk upload.

### 9. Track 5 is scope creep
**Claim:** web tab retention already preserves recent audio
(`last-audio.ts:53`), so the server lookup can wait.
**Verified:** the citation holds.
**Adjudication:** rejected.
- Track 3 replaces the whole-segment in-memory PCM with a 30 s ring buffer,
  so no whole-recording blob exists to retain.
- Keeping retention means keeping ~115 MB/hour in memory.
- Track 5 is therefore a dependency of Track 3. The plan now says so.

## Reviewer's single most important change

"Make the server-side HQ result/correction handoff durable and recoverable
before relying on client waits, reload behavior, or capture delivery reuse."
Findings 2 and 8 cover delivery durability, which is fixed. Findings 1 and 3
cover the handoff when no tab remains, which awaits Open design question 1.

## Boxholder decisions (2026-09-10)

- Finding 1 / Open design question 1: **keep unsent.** The box never sends a
  message on the user's behalf. A reloaded tab shows the pending item with
  explicit "Send HQ transcript" / "Send live text" actions.
- Finding 7 / Open design question 2: **fresh letter per part**, a
  `— part N of M —` marker, and one prompt sentence.
- The piece-length measurement against OpenRouter was approved and run. It
  used synthetic two-voice audio posted to the incident box's
  `transcribe-audio` route through the production JSON path:
  - 600 s: 400 after 4.0 s.
  - 660 s: 400 after 3.4 s.

  The plan now uses 300 s pieces over JSON. The multipart switch was dropped
  as unmeasured.

## Round 2 (verification, Codex `gpt-5.5`)

**Round-1 fixes.** Findings 1, 3, 4, 5, 6 and 8 hold. Two did not:

- **2 did not hold.** The prose added a `delivering` step, but the
  `VoiceHandoff` union lacked it. Fixed: the union gains
  `{ mode: "delivering"; emissionId }`.
- **7 did not hold.** One failure-table row still said "letters name
  recordings". Fixed wording.

**Fresh findings.**

- **The fallback marks `late` before the realtime message lands.** A crash or
  a failed send in that gap would get a correction delivered for a message
  that was never sent. Accepted and fixed: late delivery first probes for the
  original `message-id` and stays `late` until it appears. This adds no new
  state and is consistent with decision 1. The reviewer's "human decision
  required" label was declined for that reason.
- **The retry bound is lost on resume.** `requestedAt` lived only on `queued`.
  Accepted and fixed: `hqRequest { requestedAt, service, emissionId,
  sessionId }` moves to the voice object. This changes the plan's own draft
  schema only; no data exists yet, so no human decision was needed.
- **Stale speaker wording.** Duplicate of 7.

Review loop closed after round 2. Any further pass is verification-only.
