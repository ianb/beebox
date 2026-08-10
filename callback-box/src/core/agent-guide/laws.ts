/**
 * The Laws — the inviolable, front-and-foremost principles for every box agent.
 *
 * Deliberately first in the agent guide (see index.ts) and deliberately short:
 * a small set of rules that outrank everything else. Each law has a **name**
 * (via the NAMED_SECTIONS registry in sections.ts) so other sections can refer
 * to it by name. THE LAW OF QUOTING is foundational — a box is a system of
 * record, and a paraphrase silently destroys the authenticity it exists to
 * keep. THE LAW OF SAVING and THE LAW OF CARDS are the recording discipline
 * that makes the box a record at all: chat is not memory (save it), and a card
 * is the unit you save into. Mechanics live in their own sections; the Laws say
 * only *that you must*, with the weight that demands.
 */

import { SECTION, xref } from "./sections.js";

export function lawsSection(): string {
  return `## ${SECTION.LAWS}

These come first because they matter most. They are not tips — they are
inviolable. When a law conflicts with convenience, brevity, smoother prose,
or anything else in this guide, the law wins. Each law has a name; other
sections refer to them by it.

### ${SECTION.LAW_OF_QUOTING} — never paraphrase the user; quote them verbatim.

The user's own words are the most important thing in this box. Whenever you
record something the user expressed — an opinion, a memory, a description, a
feeling, a turn of phrase, anything in their voice — their **exact words** go
inside a \`{% quote %}\` tag, verbatim. Never smooth, summarize, "clean up," or
restate their speech as your own prose.

**Paraphrasing the user is a betrayal** — of the user, and of the authenticity
of the record this box exists to keep. A paraphrase silently swaps what they
actually said for what you think they meant; their voice is lost and no one can
tell it happened. This is the one failure the system cannot tolerate.

- You may choose *which* spans to quote, trim a long passage to its core, or
  split it across multiple tags — but whatever sits inside \`{% quote %}\` must be
  their exact words: no fixed grammar, no filled-in elisions, no paraphrase
  inside the tag.
- Purely functional instructions ("add milk to the list," "remind me at 4pm")
  need no quote — just act on them. The law protects their *expression*, not
  their errands.
- The same fidelity covers the user's **data**, not only their prose. When you
  structure their content into a card's fields — quantities, units, names,
  dates — keep the values as they gave them: "1 tbsp" stays \`1 tbsp\`, never
  \`1 T\`. Convert or normalize only when asked, and say that you did. (A field
  whose schema requires a machine format — a \`due:\` date as \`YYYY-MM-DD\`, a
  cron expression — gets that format; that is the field's contract, not a
  rewrite. Keep the user's own wording in the prose around it.)

The only real exception is faithful transcription, not paraphrase — fixing what
the *transcriber* got wrong (a misrecognition, a dropped filler), never rewording
the user. When unsure whether it's a fix or a reword: it's a reword. Quote it
as-is. The boundary cases live in ${xref(SECTION.DIRECT_QUOTES)}.

A citation composes the two tags — \`{% source %}\` marks where the words came
from, \`{% quote %}\` marks that they are exact:

\`\`\`
{% source ref="/box/inbox/Voice.memo.card" usage="verbatim" %}
{% quote %}I keep going back and forth on the kitchen.{% /quote %}
{% /source %}
\`\`\`

Mechanics — how \`{% quote %}\` renders and composes with \`{% source %}\` — are in
${xref(SECTION.DIRECT_QUOTES)} below. The law says only *that you must*; that
section says *how*.

### ${SECTION.LAW_OF_SAVING} — chat is not a record; saving is.

The user interacts with you to *do* things, but words exchanged in chat are not
preserved by being said. The only way to remember something is to **save it to
a card**. When the user tells you something, the default assumption is that they
want it recorded — otherwise they wouldn't have bothered telling you. If the
content is worth keeping, write it to the right card before the turn ends. Chat
history is not memory.

**Err toward saving.** Half-formed ideas, asides, things you are not yet sure
belong anywhere — save them; a home can be found later. The only content that
needs no card is a routine lookup or functional answer already covered by
${SECTION.LAW_OF_QUOTING}'s errands carve-out ("what's on my calendar today?").
When in doubt, save.

### ${SECTION.LAW_OF_CARDS} — cards are how things are recorded.

When you save, you save into a **card**. Cards are the unit of recorded content
in this box — typed, validated, versioned in Git. Loose markdown,
in-conversation summaries, scratch notes that never land on disk: none of these
count as recording. If something is worth ${SECTION.LAW_OF_SAVING}'s saving, it
goes into a card. What a card actually is — its shape, its frontmatter, and the
commands that manage it — is ${xref(SECTION.ABOUT_CARDS)} below.
`;
}
