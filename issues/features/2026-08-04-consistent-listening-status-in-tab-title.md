---
title: "Show a consistent 'listening/session active' status in the tab title (not the browser's flickering mic/speaker icons)"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder wants a steady session-on indicator
---

> **Job to be done:** *When I've got the box open in a background tab and it's
> actively listening (voice input) or talking (TTS), I want a steady at-a-glance
> "this session is live" marker on the tab, so I can tell from the tab strip that
> the box is engaged without switching to it — and not be confused by an indicator
> that keeps flipping on and off.*

Today the only tab-level signal for "the box is active" is the **browser's own
automatic indicators**: Chrome/Safari draw a mic glyph while `getUserMedia` is live
and a speaker glyph while audio plays. Those are **per-modality and flickery** — they
switch as the mic and TTS toggle moment to moment — so they read as inconsistent, not
as a stable "session is on" status. We don't control them.

## What to add

Our own **consistent listening/session-active indicator in the tab title** (and/or
favicon), driven by whether the box is in *any* active voice/listening mode rather
than tracking mic vs speaker separately. For example, prefix the title with a steady
marker (`● Listening — <box>` / a dot) whenever a voice session is engaged, and clear
it when it's fully idle — one stable state, not two flickering ones.

## Pointers

- The tab title is owned by `src/frontend/src/hooks/useDocumentTitle.ts`
  (`document.title`, restored on unmount) — currently only `BrowsePage` sets a title
  (the card name). A listening indicator would layer a prefix on top of whatever the
  current page title is.
- The "is it listening / talking" state lives in the voice hooks —
  `hooks/useRealtimeTranscription.ts` (mic/listening) and `hooks/useSpeechPlayback.ts`
  (TTS playing). Derive a single `sessionActive`/`listening` boolean from those (plus
  whatever "voice session on" state the composer holds) and feed the title.
- Decide the exact semantics: "listening" = mic armed? = a turn streaming? = any
  voice-mode-on? The point is *one* consistent status the boxholder reads as
  session-on, so pick the broadest steady state rather than the narrow
  mic-actually-capturing-right-now window that makes the browser icons flicker.

## Open questions

- Title text vs favicon swap vs both — the favicon is more glanceable in a crowded
  tab strip, the title carries words; possibly both.
- Should it distinguish *listening* (waiting for me) from *speaking/working* (box is
  busy), or is a single "session live" marker enough? Lean simple first.
