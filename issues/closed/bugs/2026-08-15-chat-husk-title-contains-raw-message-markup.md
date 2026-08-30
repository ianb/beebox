---
title: "Chat husk titles take the first message raw, markup included"
workstream: chat-session-identity
area: beebox
labels: [chat, cards]
filed-by: agent
discovered-by: agent
discovered-in: worktree-transcript-confidence — adversarial review of the <unsure> marking branch
priority: normal
resolution: implemented
---

**Closed 2026-08-26.** `7faa58b2` routed `readSnippetTitle` through `extractSnippet`/`stripSpeechWrappers`, which strips the `<speech>`/`<typed>` shell, voice markers and `<unsure>`; `ef82c2d61` added the missing `<user-selection>` rule (dropped whole — its body is a document quote, not the user's words). Pinned by `test/cli/lib/session-text-snippet.doctest.md`. Workstream chat-session-identity.
`readSnippetTitle` (`beebox/src/core/chat/husk.ts:60-77`) builds a chat
husk's starter `title` from the transcript's first user message by joining the
raw text blocks and slicing to `TITLE_MAX_LEN`. The raw text still contains
the message's embedded markup — the `<typed …>`/`<speech …>` shell with its
attributes, and any inner elements (`<user-selection>`, `<send-message>`, and
now `<unsure>` marks from the transcript-confidence work).

Consequence: a voice-initiated chat's husk card can carry a title like
`<speech stt="deepgram" user="…">Remind me to…` — markup where a human title
belongs, visible anywhere husks are listed or searched.

Pre-existing behavior (not introduced by the `<unsure>` branch; that branch
only adds one more tag to the raw text). Likely fix: run the snippet through
the same wrapper-stripping used by plain-text renderers
(`stripSpeechWrappers`, `beebox/src/cli/lib/session-text.ts`) before
slicing. Note the nightly chat review usually replaces the title later, so the
exposure is the window before review — but hand-set titles win permanently, so
a raw-markup title the user edits around can stick.
