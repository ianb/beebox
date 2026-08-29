/**
 * Marking direct quotes (verbatim words from a person) inside markdown
 * bodies. Renders as a styled inline span or block figure, distinct from
 * a generic blockquote. The *rule* (never paraphrase) is THE_LAW_OF_QUOTING;
 * this section is the mechanic that carries it.
 */

import { SECTION } from "./sections.js";

export function quotesSection(): string {
  return `## ${SECTION.DIRECT_QUOTES}

${SECTION.LAW_OF_QUOTING} says *never paraphrase the user*; \`{% quote %}\` is how
you carry exact words from any person. Mark a verbatim span with it so the words stay
visibly distinct from your paraphrase — inline within a sentence, or as a block:

\`\`\`
Mid-rant about his projects: {% quote %}I keep starting things because the start
feels so alive, and then a week in I realize I was just chasing that feeling, not
the actual thing.{% /quote %}

{% quote %}
There's something about a hand-thrown mug — it has the maker's hand in it. A
perfect machine mug feels dead to me.
{% /quote %}

{% quote from="Rina Patel, studio owner" %}
We make every installation for the particular room it will inhabit.
{% /quote %}
\`\`\`

You choose *which* spans to quote, and may trim to the core, split across tags, or
move a quote between cards — but the text inside the tag is the user's exact
words. (The full rule, and the temptations to resist, are in
${SECTION.LAW_OF_QUOTING}.)

For the **user's own words**, omit \`from\`: their voice is the default protected
by ${SECTION.LAW_OF_QUOTING}. When quoting a third party — a studio owner, an
interview subject, or attributed website copy — set \`from="…"\` to the speaker
or author. The renderer shows that attribution, keeping the third party visibly
distinct from the user's voice. \`from\` may be a display name or a person-card
ref.

A document span you're anchoring a comment to — an excerpt you're *pointing at*,
not a person's words you're recording — is not a quote: it goes in a
\`{% source %}\` body (see ${SECTION.PROVENANCE}).

When the **user directs an edit** to their own quoted words, the result is still
authentic — the quote stays a quote. It's your *unbidden* rewriting the law
forbids, not the user's own revision of what they said.

**Faithful transcription is not paraphrase.** Voice input is transcribed, and
these fixes keep a quote faithful:

- a self-correction — "ketchup, no, catch up" → "catch up";
- an obvious misrecognition, or a dropped filler;
- a **repeated sentence** — the user, seeing the first attempt came out garbled,
  says it again more clearly. Treat the two as one self-correction: keep the
  clean second version, drop the first.

See \`docs/generated/narration-mode.md\`.
`;
}
