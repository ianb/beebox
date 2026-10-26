/**
 * The `figure-it-out` skill — split from skills-content.ts for size. See that
 * file's header for the authoring conventions.
 */

/**
 * The `figure-it-out` skill: settle a question card without the person, when
 * they handed it off ("Figure it out" on the card) or when the daily question
 * review reaches it (docs/plans/questions-later-and-figure-it-out.md, Track D).
 * The box decides conservatively and records the decision as provisional, never
 * as the person's answer; simplifying the question is one way to figure it out.
 */
export const FIGURE_IT_OUT_SKILL = `---
name: figure-it-out
description: Settle a question card the person handed off or the question review brought you - decide it conservatively as provisional, or simplify and ask again. Never as their answer.
---

# Figure it out

A question card is something the box asked the person. Here they have not answered it, and you settle it for now. Your decision is provisional: it is not their answer, and it must never look like one.

## First, read

- The card: \`prompt\`, \`memo\`, \`input\` (options), \`directive\`, \`learning\`, \`context\` (read each card it links).
- Its history: \`git log --follow -p <path>\`. How often was it put away (\`dismissed-at\` set again and again)? Was it asked again before, and how?
- What the box already knows that bears on it: the briefing, the guides, similar answered questions in \`_bookkeeping/questions/\`.

## How you were called decides how it ends

- **Handed off** (the message says the person handed it to you from the question card): they want it gone. Decide it (below). If only the person can decide it, make it simpler with the \`simplify-question\` skill and leave it put away; the daily review asks it again. Never \`bbx question reraise\` here.
- **Review** (the question review brief): every put-away question ends decided or asked again. Decide it, or ask it again with \`bbx question reraise <path>\` - simplified with \`simplify-question\`, or as it is with one sentence added to the memo saying why only the person can decide it. Leaving it as you found it is not an ending: a question put away with Later must come back. A question still waiting (pending) is already being asked: decide it, simplify it in place, or leave it.

## Decide conservatively

- **The reversible choice that changes least.** File in the folder the box's rules already name as the fallback rather than guessing a new one; keep a note rather than change a rule; leave a setting as it is.
- **Never, without the person:** delete, send, publish, spend money, share, overwrite or reword their words, or decide something about their values, health, money, or other people. Those are questions only they can answer: ask again, made simpler.
- **Do it, then record it:** \`bbx question decide <path> --decision "<what you did, in one line>" --reasoning "<why this is the safe choice>" --undo "<how to reverse it>"\`. Write the decision as what the box did: "Filed in Inbox/Receipts for now", not "You chose Inbox".
- **What you learned is inferred.** If the card has a \`learning:\` sink, record the belief there with \`basis: inferred\`, never \`user-stated\`.
- **Never \`bbx answer\`** and never write \`answer:\` for a question the person did not answer. If they did answer it in a chat, that is an answer, and \`bbx answer --via chat\` is right.

## Say what you did

In the chat you were called in, one or two sentences: what you decided and how to change it, or how you asked the question again and why. Plain words, no card or command names.
`;
