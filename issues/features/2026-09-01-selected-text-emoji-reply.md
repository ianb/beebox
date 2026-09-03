---
title: "Reply to selected text with an emoji"
workstream: unattached
area: beebox
labels: [chat, text-selection, reactions]
filed-by: agent
discovered-by: Ian
discovered-in: main session — wanting to acknowledge a question without composing a textual reply
---

When I select a specific question or passage in chat, I want to send an emoji
as the complete reply, so I can acknowledge or answer that passage without
opening the composer and writing a message.

The selection affordance currently offers `+`. It adds the selected text as
reply context for a normal composed message. This is too much interaction when
the intended response is only 👍 or another short reaction.

Add an adjacent path that sends an emoji as a reply to the selected passage.
The resulting chat turn must retain the selection as its target. It must not
look like an unscoped emoji sent to the whole conversation.

The design must decide whether to show a small fixed emoji set, an emoji
picker, or a recent/favorite set. It must also make accidental immediate sends
unlikely without making the common thumbs-up case slow.

This is a reply, not only decorative reaction metadata. The agent should
receive the selected passage and the emoji response as a complete user turn.

## Research (incomplete)

