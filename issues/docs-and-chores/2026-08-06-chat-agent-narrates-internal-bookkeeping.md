---
title: "Chat agent narrates internal bookkeeping the user doesn't care about"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder noticed it in a live chat exchange
---

> **Job to be done:** *When I glance at a chat reply after asking for something,
> I want to see the answer or a brief acknowledgment — not the agent's own
> housekeeping. So the exchange reads like a conversation with an assistant, not a
> transcript of the assistant talking to itself about its files.*

The chat agent surfaces **internal bookkeeping** as user-facing prose. In the
observed exchange the user said "You can close the intra stuff. Stuff like a
reddit tab, generic site home, those can all be closed, I can get back." — and the
agent's visible replies were:

- "Updating the `contains:` summary since the window count and close count changed."
- "Under 200 chars now."

Both are the agent narrating its own field-maintenance mechanics (editing a
`contains:` frontmatter summary, watching a character budget). Neither is
information the user asked for or benefits from. The *work* (edit the card) is
fine; **saying it out loud in chat is the problem.** Contrast the good pattern
already in the prompt for tool activity — an `<ack>` for "work done" — rather than
a prose play-by-play of the edit.

## Likely fix — a prompt line

`CHAT_SYSTEM_PROMPT` (`callback-box/src/core/chat/session/prompts.ts:21`) already
opens "Working in chat" with **"Be concise. This is a conversation, not a
report."** The natural home for the fix is right there: add a short line that
internal bookkeeping — updating a `contains:` summary, keeping a field under a
length budget, reconciling counts, routine card maintenance — is **not chat
content**. Do the edit (an `<ack>` at most), don't narrate the mechanics. The
user cares about outcomes and answers, not the agent's file-keeping.

Keep it a **general** instruction, not a `contains:`-specific patch — `contains:`
is just the instance that surfaced it; the class is "narrating internal
bookkeeping." Watch the wording so it doesn't over-suppress genuinely useful
"here's what I changed" replies when the user actually asked what changed.

## Related

- [chat output vocabulary ia pass](2026-06-02-chat-output-vocabulary-ia-pass.md)
  — adjacent chat-prompt/output-shaping work, but that item is about the *tag
  vocabulary* (`<ack>`, `<callout>`, `{% quote %}`); this is about *what the agent
  chooses to say*, so it's a separate, smaller tweak.
- `callback-box/docs/prompt-surface-review.md` — the workflow for reasoning about
  prompt-content changes like this, if the fix wants more than a one-liner.
