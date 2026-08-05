---
title: "Recovered dictation should have a minimum size before it's surfaced"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder
---

> **Job to be done:** *When a dictation gets interrupted and I've only mumbled a
> word or two, I don't want a "recover this draft" prompt cluttering the composer —
> a scrap that small isn't worth restoring, so just drop it.*

Recovered dictation is surfaced whenever a `recoveredDraft` exists, with no size
floor — `useRecoveredDictation` (`src/frontend/src/components/chat/InteractiveChat-recovery.tsx:63`)
gates only on `recoveredDraft && !isTranscribing && !hqInFlight`. So a trivially
small recovery (a word or two) still pops the recovery affordance, which isn't
worth the interruption.

## Fix

Add a minimum-size threshold: only surface recovered dictation when the draft is
**more than two words, or more than ~20 characters** (whichever framing is cleaner
in the code — a char count is simplest and robust to punctuation). Below the
threshold, drop the recovered draft silently (clear it) instead of surfacing it.

Small, self-contained — the gate is the one spot in `InteractiveChat-recovery.tsx`.
A pure-ish check that's easy to doctest (a 1–2 word / <20 char draft → not
surfaced; a longer one → surfaced).
