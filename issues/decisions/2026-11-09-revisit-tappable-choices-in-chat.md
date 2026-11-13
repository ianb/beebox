---
title: "Revisit tappable choices in chat: the boxholder asked for a pick-several prompt after the 2026-07-10 wontfix"
workstream: unattached
needs: [decision]
area: beebox
labels: [chat]
filed-by: agent
discovered-by: Ian
discovered-in: "courseware box feedback — Multi_Select_Choices_In_Chat, 2026-11-09"
---

On 2026-07-10 the boxholder closed
[in-chat interactive questions](../closed/features/2026-06-09-in-chat-interactive-questions.md)
as wontfix: in chat the agent asks in prose, and `box/questions/` is the only
structured-question primitive.

On 2026-11-05, in a box used for course experiments, the boxholder asked for
the same family of element with a different shape: "what sounds most
interesting?", a few options, and the ability to select as many as you want.
The boxholder noted: "I don't think we have this really as a capability."

The case differs from the closed one. The agent does not need an answer to
continue. It offers the person a menu of next directions, and the person
chooses one or several, quickly and without typing.

## What exists

- Landmark openers: one-click first messages, single choice, fixed per place,
  only on an unstarted chat.
- Question cards: `select` is single choice, and the question goes to the
  boxholder through the Questions page, not to the person in the chat.
- A box view can render checkboxes and save the picks to a card, but only
  while the view is open beside the chat.

## Shape the box agent proposed

An agent-emitted chat element, a sibling of `<ack>` and `<callout>`: a prompt
plus options with `multiple="true"`. Submission arrives as the person's next
message ("Picked: A; C"). It works on mobile, works by voice ("the first
two"), and leaves a record in the transcript.

## Decision

Does this request reopen the 2026-07-10 decision, or does prose stay the
answer for in-chat choices? Docs that cite the wontfix:
`beebox/docs/questions.md`, `research/openui/README.md`,
`research/openui/beebox-fit.md`.
