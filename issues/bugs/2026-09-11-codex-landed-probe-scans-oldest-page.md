---
title: "userMessageAlreadyLanded's Codex-engine branch scans the oldest page of a long thread, so a recent message can read as not-landed"
workstream: hq-recording-resilience
area: beebox
labels: [chat, codex-engine, transcription]
filed-by: agent
discovered-by: agent
discovered-in: worktree-hq-recording-resilience — cross-model review of the voice-recording plan's step 5 (late HQ delivery re-probes this function)
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
`docs/plans/resilient-voice-recording.md`). It was found while designing that
plan's late HQ correction, which would have re-probed repeatedly. That feature
was removed on 2026-09-10 in the plan's scope reduction, so no voice code
depends on the probe now.

**Where this is reachable today:** `capture` and `bulk` deliveries call the
probe once, as a crash-resume check. On a Codex-engine thread longer than
5000 entries, a false "not landed" makes a resumed capture or bulk delivery
send its message a second time. The user would see a duplicate `<capture>` or
`<upload>` message. This happens only after a crash between send and the
`delivered` marker, so it is rare.

**Possible fix:** change the Codex-engine branch to page from the tail (mirror
`chatHistorySlice`'s `{ mode: "tail", tail: N }`) or add a purpose-built
contains/marker search over the whole Codex thread that doesn't materialize an
unbounded response window. Needs a decision on how `loadSessionHistory`'s
Codex path should expose "search for a marker" without adding a third slice
mode used by exactly one caller.
