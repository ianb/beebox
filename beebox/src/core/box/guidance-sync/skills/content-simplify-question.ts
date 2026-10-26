/**
 * The `simplify-question` skill — split from skills-content.ts for size. See
 * that file's header for the authoring conventions.
 */

/**
 * The `simplify-question` skill: rewrite a question card so it is simpler for
 * the person to decide or to understand (docs/plans/questions-later-and-figure-it-out.md,
 * Track D). Simpler is not shorter: often it is more concrete. The
 * `figure-it-out` skill uses it as one way to settle a question.
 */
export const SIMPLIFY_QUESTION_SKILL = `---
name: simplify-question
description: Rewrite an unanswered question card so it is simpler for the person to decide or understand - concrete, with the box's default, or split.
---

# Simplify a question

A question that keeps being put away is usually hard to answer as asked. Make it simpler for the person to decide, or simpler to understand. That is not the same as shorter: often the simpler question is longer, because it shows the actual thing.

## Ways to make it simpler

- **Make it concrete.** Name the actual item, date, or person. "Where should receipts go?" becomes "This receipt from Pemberton Hardware ($42, a hinge) - should it go with the house repairs or with general receipts?"
- **Say what the box would do.** Give the default and ask only for a change: "I'll file hardware receipts under house repairs unless you'd rather keep them together."
- **Make the answer easy to say.** Something the person can answer in a sentence, out loud, without looking anything up. Put what they need to know in the \`memo\`, briefly.
- **Split it.** When part of it is safe for the box to decide and part is not, decide the safe part (\`bbx question decide\` on this card, per \`figure-it-out\`) and ask the rest as a new question card.
- **Ask about one thing.** A question with an "and" in it is two questions.

## How

- Edit the card in place: \`title\` (a few words naming it), \`prompt\`, \`memo\`, and \`input\` (a \`select\` question's options must still be ones \`bbx answer\` can record). Keep its \`directive\` and \`learning\` true to the new wording. Git keeps the old version.
- Never change the card's lifecycle fields by hand. Asking it again is \`bbx question reraise <path>\`, and only where \`figure-it-out\` says to.
- Commit with a message that says how you made it simpler.
`;
