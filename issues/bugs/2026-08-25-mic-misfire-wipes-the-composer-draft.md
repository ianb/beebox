---
title: "A failed recording start wipes the half-typed composer draft"
workstream: unattached
area: beebox
labels: [journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk
priority: important
---

## Recovery assessment (2026-09-21)

Still an unverified historical observation. Current voice-start paths invoke
`START_DICTATION` and recording-start failure returns the transcription machine
to idle, but this inspection did not locate a current typed-draft clear point.
Do not infer a confirmed present data-loss bug or a fix from adjacent native-iOS
voice-turn changes. The original report's lack of an independent reproduction
continues to apply.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


Journey A's walker fat-fingered the microphone button while typing. Recording
failed to start ("Recording didn't start. Please try again.") — and the
half-typed message was gone.

> "Losing what I'd typed because a *different* control misfired is rude."

The mic press was their mistake; the draft loss is ours. Starting a recording
plausibly clears the composer to make room for the transcript — but on the
failure path nothing was recorded, so there is nothing to make room for, and
the draft should come back. The emission/draft persistence layer may even still
hold it (see the draft-recovery machinery in `input/emission-persist.ts`);
if so this is a restore-on-failure wiring gap rather than data loss.

Not reproduced outside the walk; the walker's account is the evidence. Verify
the exact clear point when picking this up.
