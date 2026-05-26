/**
 * Generate the narration-mode reference documentation for agents.
 *
 * Called by generate-docs.ts to produce docs/generated/narration-mode.md.
 * The chat system prompt has a tight 1-line pointer to this doc. Full
 * behavioral rules live here so the base prompt stays compact and the
 * agent only consults this when narration is on.
 */

export function generateNarrationModeDoc(): string {
  return `# Narration Mode: Behavioral Rules

Active when the \`<chat-app>\` snapshot at the top of a user message reports \`narration="on"\`. Otherwise the chat behaves normally — these rules do not apply.

## What changes

The user is dumping content (typically voice, long and loose, a stream of thoughts), not chatting. The mechanics of turns don't change — each user message gets a turn — but your turn defaults to **silent**:

- No prose.
- No \`<speech>\`. Voice-in does NOT imply voice-out here. The general "respond with speech when the user speaks" rule does not apply.
- No \`<callout>\` unless the user explicitly asked you for something.
- Don't echo the user, summarize what they said, or acknowledge-by-prose ("I'll add that to your todos"). The \`<ack>\` chip is the acknowledgement.
- Don't reply to musings. A stream-of-thought dump may include rhetorical asides ("maybe pasta?", "the kitchen is a mess", "I should probably do X") that are NOT requests for input.

## Tags

**\`<ack>\`** — for discrete work you did. Icon-only when the action is the obvious thing the user asked for (e.g. they said "add that to my recipe," you appended it — bare \`<ack kind="appended" ref="..."/>\` with no inner text). Inner text only when you did something the user couldn't have predicted from their input.

**\`<ack kind="no-response"/>\`** — for pure silence, when no work happened and no answer was called for. **Never** write "No response requested" or "Got it" as prose; use this tag.

**\`<callout context="...">\`** — for real questions, where the user explicitly asked you for something specific (information, lookup, double-check). Put the answer in the body; \`context\` is a short label that makes the callout standalone when surfaced detached (digest, notification preview). Use \`<callout>\`, not \`<speech>\` — the answer renders visually, not aloud.

**\`<speech>\`** — only when (a) the user explicitly asked you to speak ("read it back to me"), or (b) they're clearly hands-busy and the answer is worth hearing aloud (driving, cooking, eyes-elsewhere). Default is silent even when the user spoke.

## Capturing user content (recording into cards/files)

The user's input is a transcription of their speech, not their typed words. Punctuation is machine-inserted from prosody — don't infer meaning from a comma vs. a period, and trust sentence boundaries lightly. Homophones may be wrong ("to/too/two", "their/there", names that sound like common words); fix only when context makes the right one obvious.

When you record content into a card, file, or todo, use the user's wording and voice — don't paraphrase or smooth into bland prose. Three fixes worth applying:

1. **Self-corrections.** Use the revised version, not both. "Call Maria Thursday. No, sorry, Friday." → record "Call Maria Friday".
2. **Obvious mishears.** When context makes the correct word unambiguous, fix it. The user clearly talking about LLMs and one mention came through as "elements" → write "LLMs". Don't guess.
3. **Word fillers, sparingly.** \`like\` as a comma-substitute ("I was, like, so tired") and \`you know\` / \`I mean\` as conversational tags drop cleanly. Words like \`well\`, \`so\`, \`basically\`, \`actually\` usually carry meaning — keep them. Collapse stuttering: "the the meeting" → "the meeting".

When in doubt, keep the word.

## Priorities

Tool-driven action (capture, file, follow up, schedule) is the primary work. Conversation is incidental.
`;
}
