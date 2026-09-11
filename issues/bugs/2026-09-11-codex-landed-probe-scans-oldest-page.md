---
title: "userMessageAlreadyLanded's Codex-engine branch scans the oldest page of a long thread, so a recent message can read as not-landed"
workstream: hq-recording-resilience
area: beebox
priority: normal
labels: [chat, codex-engine, transcription]
filed-by: agent
discovered-by: agent
discovered-in: cross-model review of docs/plans/resilient-voice-recording.md, implementation-order step 5
---

`userMessageAlreadyLanded` (`src/core/chat/session/deliver-user-message.ts`)
has two branches. The default (Claude) branch streams the session's raw JSONL
line by line, so a marker anywhere in the file is found regardless of
transcript length. The Codex-engine branch instead calls:

```ts
const { entries } = await loadSessionHistory(boxRoot, {
  sessionId,
  slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES },
});
```

`adaptCodexThreadHistory`'s page mode (`src/core/chat/session/codex-transcript.ts`)
implements `"page"` as `entries.slice(offset, offset + limit)` — the FIRST
`MAX_SESSION_ENTRIES` (5000) display entries, not the most recent ones. In a
Codex-engine chat whose thread has grown past 5000 entries, a message that
landed near the tail is invisible to this probe: it reads as "not landed" even
though it is genuinely there.

This is pre-existing (not introduced by the `docPath` → `marker` rename in
implementation-order step 5 of `docs/plans/resilient-voice-recording.md`), but
that step's `deliver-late.ts` is the first caller to depend on this probe
returning an accurate answer REPEATEDLY over time for the same marker
(late-delivery's `correctionLanded` re-probe on every sweep tick and on
resume). A false negative there does not corrupt state — `attemptLateDelivery`
just re-attempts the send behind an idempotent per-recording in-flight guard —
but on a long-running Codex-engine box it could mean the correction is sent
more than once before the probe ever reports "landed", each landing as its own
message in the transcript.

**Where this is reachable today:** `capture` and `bulk` deliveries call the
same probe once, as a crash-resume check; a stale false-negative there just
means a resumed capture/bulk delivery is retried (idempotent by construction:
filename+bytes replay, a CAS session state), not a second user-visible
message. Voice late-delivery is the first caller where a false negative can
plausibly produce more than one delivered chat message for the box user to
see.

**Possible fix:** change the Codex-engine branch to page from the tail (mirror
`chatHistorySlice`'s `{ mode: "tail", tail: N }`) or add a purpose-built
contains/marker search over the whole Codex thread that doesn't materialize an
unbounded response window. Needs a decision on how `loadSessionHistory`'s
Codex path should expose "search for a marker" without adding a third slice
mode used by exactly one caller.
