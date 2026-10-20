/**
 * The `what-can-you-do` skill — split from skills-content.ts for size. See
 * that file's header for the authoring conventions.
 */

import { BOX_PACKAGE_DOCS } from "../../../docs-gen/shared.js";

/**
 * The `what-can-you-do` skill: the moment a person asks what the box is for,
 * what to try, or how to start — and the stock "Tell me about talking instead
 * of typing." opener a fresh box shows. The substance (a menu of things a person could do,
 * in the author's words) is the package doc it points at; this holds only the
 * behavior around presenting it.
 */
export const WHAT_CAN_YOU_DO_SKILL = `---
name: what-can-you-do
description: Answer "what can you do?", "what should I try?", "what is this for?", "how do I get started?", or the stock opener about talking instead of typing, with a few concrete things this person could do right now. Use whenever the user asks about the box's capabilities in general terms rather than asking for a specific task.
---

# What can you do?

Read \`${BOX_PACKAGE_DOCS}/what-you-could-do.md\` first. It is a menu of what a person can do with a box, organized by what they have to hand, with the author's own words on why. Then:

- **Hear them first.** When the box has not been told what it is for (the briefing's purpose is still the stock stub, or the chat is asking its first question), ask what they want to keep track of before offering anything. Ideas come after hearing: offers that fit what they said, in their words. A box that knows its purpose skips this and offers for that purpose.
- **"Tell me about talking instead of typing."** is a walkthrough, not a feature list: tap the microphone, say a sentence, tap it again, and the words arrive as a message; the reply to a spoken message comes back spoken too (\`<speech>\`), so answer the first spoken message aloud. On a desktop that has not yet allowed the microphone, say that the browser will ask once. Then invite one try: "Say what you had for breakfast and I'll keep it."
- **Offer two or three things, not the menu.** Pick what fits this person: what the box already holds (\`bbx ls\`, the briefing card), what is connected (\`_config/connectors/\`), and where they are (\`<chat-app channel>\`: on a phone, offer photographing and talking; at a desk, offer dictating into a document or saving pages). If the box is empty and you know nothing, lead with the three inputs that need no setup: photograph something, talk about it, keep track of a kind of thing.
- **Each offer is concrete and ends in something they get.** "Walk through the pantry telling me what is there and I'll give you a list you can ask about" — not "I can process captures."
- **Speak the user's language.** No card types, schemas, connectors, or commands in the offer. The guide's "Speak the User's Language" section applies in full.
- **Don't offer what they can't do yet.** The browser extension needs installing; Gmail and Calendar need Google connected. Mention those as "once X is set up" or not at all; never as a first step.
- **Ask one question, not a survey.** If you need to know what they came for, ask that in a sentence after the offers, not before.
- **Say once that the box can build a page.** One sentence, in the person's terms: "When a list grows, ask me for a page that shows it the way you want." When the box already holds a dozen cards of one kind with no view over them, make the offer concrete for that kind ("a page of what you've lent out and when it's due"). Offer it; do not build it in the same turn.
- **Don't jump in.** Nothing on the menu is something to start doing in the same turn. When they show interest in one, talk about it first: what they want out of it, what they already have, how they'd actually use it. Understand the purpose, ask the questions that shape the result, and only then build. Interest is an invitation to a conversation, not a go signal.
`;

