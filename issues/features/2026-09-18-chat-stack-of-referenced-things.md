---
title: "A stack of \"what I'm talking about\" in chat: the cards an answer refers to, shown together"
workstream: unattached
area: beebox
labels: [chat, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder wanting a better way for the agent to show what it is referring to
---

When a chat answer is about several things — three photos, the two documents
it compared, the cards it just filed — the agent's only way to point at them is
a markdown link per item inside its prose (`view:` links, parsed by
`beebox/src/frontend/src/lib/view-url.ts`). The reader gets a paragraph with
links in it, not the things.

The boxholder wants a stack: the items under discussion, shown together as
"stuff I'm talking about", and suggests the `<callout>` system as the place it
belongs.

## Why callout is the right neighbor

`<callout context="...">` already exists for content the reader must actually
see, and it is the only channel that survives narration mode and `prose="off"`
(`beebox/src/core/chat/session/prompts.ts:152-156`;
`components/chat/CalloutBlock.tsx`). It has the two halves this needs: a
`context` eyebrow answering "why am I being shown this", and a body the agent
composes. A stack of referenced things is the same shape with items instead of
prose.

Whether it becomes a variant of `<callout>`, a sibling tag, or a callout whose
body is a list of refs is the design question. The boxholder's standing
preference is to minimize invented concepts, so a sibling tag needs to earn
itself against reusing what is there.

## What to work out

- **What an item is.** A card ref covers most of it, but a stack of three
  photos wants thumbnails, and a stack of two documents wants titles. Whether
  the stack renders per-type previews or one uniform row decides how much new
  UI this is.
- **Who builds the stack.** The agent naming refs explicitly is the simple
  version. Deriving it from what the turn touched is tempting and probably
  wrong — the things an agent read are not the things it is talking about.
- **How it behaves when tapped.** `CalloutBlock` already routes a `view:` link
  through `onZoomView`. A stack item should land in the same place.
- **Narration and digests.** A callout is written to stand alone in a digest or
  notification. A stack of thumbnails does not survive that trip; it needs a
  text form, or a rule that the spoken/digest version is the context line.
- **How many is too many.** A stack of 30 is a list nobody reads. Whether the
  agent chooses or the UI truncates.

## Prior art here

- `<ack>` (`prompts.ts:150`) already carries a `ref` for one thing the turn
  changed, with a required `kind`. A stack is plural and about attention
  rather than change, but the ref vocabulary is shared.
- [Typed log attachments on cards](2026-06-22-typed-log-attachments-on-cards.md)
  is the same "several typed things attached to one thing" shape on the card
  side.
- Dev-side exhibits (`workstreams-app/docs/exhibits.md`) solved a related
  problem for a different audience: labeled figures with one explicit ask.
  Worth reading for what a "labeled set of artifacts" needs, not for reuse —
  the boxholder chose the chat surface for this one.
