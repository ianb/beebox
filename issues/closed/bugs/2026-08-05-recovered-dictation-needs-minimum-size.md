---
title: "Recovered dictation should have a minimum size before it's surfaced"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder
resolution: implemented
---

Resolved by `efbf701a`. Recovered drafts must contain more than
20 trimmed characters before the recovery affordance appears. The recovery hook
silently clears smaller drafts through its existing `clearDraft()` path.

> **Job to be done:** *When a dictation gets interrupted and I've only mumbled a
> word or two, I don't want a "recover this draft" prompt cluttering the composer —
> a scrap that small isn't worth restoring, so just drop it.*

Recovered dictation was surfaced whenever a `recoveredDraft` existed, with no
size floor — `useRecoveredDictation`
(`callback-box/src/frontend/src/components/chat/InteractiveChat-recovery.tsx:63`) gated only
on `recoveredDraft && !isTranscribing && !hqInFlight`. So a trivially small
recovery (a word or two) still popped the recovery affordance, which was not worth
the interruption.

## Fix

Add a minimum-size threshold: only surface recovered dictation when the draft is
**more than two words, or more than ~20 characters** (whichever framing is cleaner
in the code — a char count is simplest and robust to punctuation). Below the
threshold, drop the recovered draft silently (clear it) instead of surfacing it.

Small, self-contained — the gate is the one spot in `InteractiveChat-recovery.tsx`.
A pure-ish check is easy to doctest (a 1–2 word / <20 char draft is not surfaced;
a longer one is surfaced).
