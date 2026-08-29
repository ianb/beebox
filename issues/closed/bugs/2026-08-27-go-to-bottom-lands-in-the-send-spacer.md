---
title: "Go-to-bottom during a streaming reply scrolls into the last-turn spacer's white space, past the generated text"
workstream: small-bugs-batch
area: callback-box
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "it scrolls to the bottom of the white space; it should only scroll to the bottom of the generated text"
resolution: implemented
---

Closed 2026-08-29 by this commit (`fix(chat): stop go-to-bottom at live turn content`): live turns expose their content bottom, which now drives both the button target and at-bottom measurement.

The send anchor gives the last turn a viewport-tall `min-height` spacer
(`InteractiveChat-messages.tsx:299-308`) so the new user message can sit at
the top while the reply streams in below. `scrollToBottom` (the floating
button) writes `scrollHeight - clientHeight` (`chat-scroll.ts`,
`writeToBottom`) — which includes the spacer's empty remainder. Hit the button
mid-stream and you land staring at white space below the last generated text.

Fix direction: while the last-turn spacer is active, the button's target is
the bottom of the *content* inside the spacered turn (the turn element's
content box), not the scroller's `scrollHeight`. When the turn completes and
the spacer collapses, the two targets converge and the current write is right
again. The at-bottom threshold (`AT_BOTTOM_PX`) may need the same awareness —
a reader at "bottom of text" inside a spacered turn should count as at-bottom
for follow behavior.

Owner: the live `chat-scroll` workstream — same file, same model.
