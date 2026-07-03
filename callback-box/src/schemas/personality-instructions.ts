/**
 * Agent-facing instructions prose for personality cards. Extracted from
 * personality.tsx so the schema module stays under the line limit; the
 * string is embedded verbatim into the schema's `instructions` field.
 */

export const PERSONALITY_INSTRUCTIONS = `# Handling Personality Cards

A personality card defines the agent's **voice and manner** — how it
communicates, not what the box is about.

There is one personality card per box at
\`config/main.personality.card\`.

**This card is about communication style ONLY.** Do NOT put situational
context here. The box's purpose, key people, and essential facts belong
in the briefing card (\`briefing.briefing.card\`). The personality card
answers "how should I talk?" — the briefing card answers "what am I
working on?"

## Frontmatter

- \`goes-by:\` — What the agent is called
- \`role:\` — The agent's general function (e.g., "Personal information
  aide"). About what the agent *does*, not what the box contains.
- \`boxholder:\` — \`{relationships?}\`. Only the relational notes about
  how the agent relates to the boxholder(s); each relationship is
  \`{text, confidence?, source?, ref?}\`. **Who** the boxholder is is NOT
  stored here — it comes from the person card(s) flagged \`boxholder: true\`
  (\`people/First_Last.person.card\`), which is the single source of truth
  and scales to several boxholders (a family, an ledger). The compiled
  "Your boxholder is …" line is generated from those person cards.
- \`speaking-voice:\` — \`{model?, instructions?}\` for TTS in the chat
  frontend (see below).
- \`tone:\` — array of \`{text, confidence?, source?, ref?}\` —
  instructions about how the agent writes (phrasing, formality,
  interaction style).
- \`traits:\` — array of \`{text, confidence?, source?, ref?}\` —
  personality traits.
- \`unresolved:\` — array of free-form notes about open questions.
- \`experiments:\` and \`context-notes:\` — same shape as guide cards.

## Body (markdown)

The compiled "description" paragraph — prose that captures the overall
vibe. When editing traits, **always rewrite the body** to reflect the
updated traits, experiments, and unresolved notes. The body is what
job agents see; it should capture the overall vibe, not just list
traits.

## Speaking voice

The \`speaking-voice\` field configures the chat TTS voice. Applies
only to the chat frontend — jobs, procedures, and other agents don't
use TTS. The \`model\` picks one of 13 OpenAI voices (impressions are
subjective; experiment to find a fit):

- \`alloy\` — Low female voice, somewhat older/mature, perhaps Black
- \`ash\` — Deep male voice, somewhat gravelly
- \`ballad\` — British male voice, high pitched, younger/peppy
- \`cedar\` — Male, medium, glitchy but engaged
- \`coral\` — Female, medium, enthusiastic but with an impersonal affect
- \`echo\` — Neutral, could be male or female, naive
- \`fable\` — British female voice, upper class, posh
- \`marin\` — Female, medium, glitchy but very personal, younger feeling (default)
- \`onyx\` — Male, low, deep and smooth, perhaps Black
- \`nova\` — Female, high, engaged and personal
- \`sage\` — Female, high, perky and light
- \`shimmer\` — Female, medium, direct and personable
- \`verse\` — Male, medium, smooth and professional, perhaps impersonal

\`instructions\` is an array of style guidance — affect, tone, pacing,
emotion, pronunciation. These apply to every spoken response. Keep
instructions sensory and specific ("Warm and unhurried, with a slight
lilt; pause briefly before names") rather than abstract ("be friendly").

## Evidence model

Same as guides — confidence (hypothesis → confirmed), source
(user-stated > feedback > inferred > default). Applies to traits, tone
instructions, and boxholder relationship notes.

## Boxholder section is relational

Not biographical. It captures how the agent relates to the person —
interaction patterns, preferences, working relationship. Biographical
details (job, family, deep interests) belong in person cards
(\`people/First_Last.person.card\`) or the briefing card.`;
