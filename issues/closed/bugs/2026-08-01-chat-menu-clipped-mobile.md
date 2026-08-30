---
title: "Chat header \"...\" menu clipped/unreachable on narrow phones"
workstream: chat-menu-mobile-overflow
area: beebox
filed-by: agent
discovered-in: worktree-chat-menu-mobile-overflow — implementing docs/plans/chat-header-chips.md
resolution: implemented
---

**Closed (implemented + browser-verified) 2026-08-01.** Fixed by
`docs/plans/chat-header-chips.md`: the chat header's row of eight-plus icon
buttons was replaced with three stateful chips (context, voice, "..." chat
menu). Landed across `441900b3`, `d45b291d`, `36484847`, `ee871edf` (chunks
1-4) and the final cleanup/verification pass (chunk 5, this commit). Verified
with `bin/browse` at 320x568, 375x667, 390x844, and 1280x800 — every header
control visible and operable at each width, all three menus open un-clipped
at 320px and 1280px, no horizontal page scroll at 320px.

## The bug

The chat header (`InteractiveChat-layout.tsx`) was a non-wrapping flex row of
individual icon buttons (mute, narration badge, landmark links, recent files,
new session, session history, the "..." debug menu, etc.) with no responsive
classes. An ancestor had `overflow-hidden`. When the row's intrinsic width
exceeded the viewport, the rightmost items were clipped — still in the DOM
and accessibility tree, but invisible and unreachable by mouse or touch. The
"..." menu was the last item, so it was the first casualty: at a 320px
viewport the button measured `left: 322.8px`, fully off-screen. The break
point depended on which conditional controls rendered (context link,
landmark button, narration badge), so "fits on my phone" was never a stable
property of the row.

## Fix

Re-IA'd per `docs/plans/chat-header-chips.md`: `[Chat title] [ContextChip
(truncates)] ·spacer· [VoiceChip] [ChatMenu "..."]`. The row now has exactly
one flexible member (the context chip, `min-w-0` + `truncate`); the title and
both right-side chips are fixed, giving the row a small known minimum width.
Chunk 5 also caught and fixed a real remaining overflow bug found during
verification: the context chip's trigger `<button>` was missing `w-full`, so
as a form control it shrink-to-fit its content instead of filling its
flex-shrunk wrapper — a long landmark label would overflow the chip and
visually bleed into the voice/menu chips instead of truncating. Fixed in
`ContextChip.tsx` by adding `w-full` to the trigger button.

**Repro (pre-fix):** on a narrow phone (≤~355px), open a chat — the "..."
menu button is off-screen and unreachable.
