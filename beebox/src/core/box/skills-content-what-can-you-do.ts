/**
 * The `what-can-you-do` skill — split from skills-content.ts for size. See
 * that file's header for the authoring conventions.
 */

import { BOX_PACKAGE_DOCS } from "../docs-gen/shared.js";

/**
 * The `what-can-you-do` skill: the moment a person asks what the box is for,
 * what to try, or how to start — including the stock "What can you do?"
 * opener a fresh box shows. The substance (a menu of things a person could do,
 * in the author's words) is the package doc it points at; this holds only the
 * behavior around presenting it.
 */
export const WHAT_CAN_YOU_DO_SKILL = `---
name: what-can-you-do
description: Answer "what can you do?", "what should I try?", "what is this for?", or "how do I get started?" — including the stock opener a new box shows — with a few concrete things this person could do right now. Use whenever the user asks about the box's capabilities in general terms rather than asking for a specific task.
---

# What can you do?

Read \`${BOX_PACKAGE_DOCS}/what-you-could-do.md\` first. It is a menu of what a person can do with a box, organized by what they have to hand, with the author's own words on why. Then:

- **Offer two or three things, not the menu.** Pick what fits this person: what the box already holds (\`bbx ls\`, the briefing card), what is connected (\`_config/connectors/\`), and where they are (\`<chat-app channel>\`: on a phone, offer photographing and talking; at a desk, offer dictating into a document or saving pages). If the box is empty and you know nothing, lead with the three inputs that need no setup: photograph something, talk about it, keep track of a kind of thing.
- **Each offer is concrete and ends in something they get.** "Walk through the pantry telling me what is there and I'll give you a list you can ask about" — not "I can process captures."
- **Speak the user's language.** No card types, schemas, connectors, or commands in the offer. The guide's "Speak the User's Language" section applies in full.
- **Don't offer what they can't do yet.** The browser extension needs installing; Gmail and Calendar need Google connected. Mention those as "once X is set up" or not at all; never as a first step.
- **Ask one question, not a survey.** If you need to know what they came for, ask that in a sentence after the offers, not before.
- **Don't jump in.** Nothing on the menu is something to start doing in the same turn. When they show interest in one, talk about it first: what they want out of it, what they already have, how they'd actually use it. Understand the purpose, ask the questions that shape the result, and only then build. Interest is an invitation to a conversation, not a go signal.
`;

