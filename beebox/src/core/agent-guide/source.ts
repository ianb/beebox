/**
 * Marking provenance: where wrapped content came from and (optionally)
 * how it was derived. Renders as a small citation chip linking to the
 * source. Composes with `{% quote %}` for "verbatim from there."
 */

import { SECTION } from "./sections.js";

/**
 * The one statement of how a ref path is written, shared verbatim by every
 * guide section that states it (here and ABOUT_CARDS) so the two can't drift.
 * The behavior it describes is `resolveRefPath` (`src/shared/ref-path.ts`).
 */
export const REF_PATH_RULE =
  "**Always write a leading `/` — the path resolves from the box root.** " +
  "The one exception is `attach/…`, the card's own attach scope. Never `../`. " +
  "A bare path resolves relative to the document it's written in — legacy, still resolves, not what you write.";

export function sourceSection(): string {
  return `## ${SECTION.PROVENANCE} — the \`{% source %}\` tag

When you write content that's derived from another card or file —
a summary of a memo, an inference from an email, a name pulled from
a transcript — wrap it in a \`{% source %}\` tag so the origin stays
visible. The complement to \`{% quote %}\`: where \`{% quote %}\` answers
*whose exact words*, \`{% source %}\` answers *where the content came
from*, optionally *how* it was derived.

\`\`\`
{% source ref="/box/inbox/Voice_2026-03-15.memo.card" usage="summary" %}
She's been going back and forth on the kitchen — open shelves vs.
closed, mostly because she doesn't trust herself to keep them tidy.
{% /source %}

{% source ref="/people/Dana_Lee.person.card" usage="inferred from her email signature" %}
Dana lives in Portland.
{% /source %}
\`\`\`

### \`ref\` — pointing at another card

\`ref\` is the box's pointer to another card, used throughout the guide:
frontmatter (\`{ref: "..."}\`, \`key-people[].ref\`), body links, and tags
like this one. ${REF_PATH_RULE}
Refs are tracked automatically — \`bbx validate\` warns when a \`ref\` no
longer resolves, and \`bbx mv\` rewrites them when the target moves. Inside
\`{% source %}\`, exactly one of \`ref\` / \`href\` is **required** — it names
where the wrapped content came from.

### \`usage\` — how the source was used

Optional, free-form natural language describing *the way the source material
was used* to produce the wrapped content. Not an enum — write the truth.

Examples spanning the range:

- \`usage="verbatim"\`
- \`usage="paraphrase"\`
- \`usage="summary of the third section"\`
- \`usage="calculated from the figures in the table"\`
- \`usage="inferred from Maria's preference for X"\`
- \`usage="extracted name"\`
- \`usage="agent's own framing based on the conversation"\`

Honest description beats enum-fitting. If the derivation has a
specific shape, name it. If it's just "summarized," say so. Don't
collapse everything into \`verbatim\` or \`paraphrase\` when the truth
is sharper.

### Composition with \`{% quote %}\`

The two tags compose to express "verbatim from there":

\`\`\`
{% source ref="/box/inbox/Voice_2026-03-15.memo.card" usage="verbatim" %}
{% quote %}I keep going back and forth on the kitchen.{% /quote %}
{% /source %}
\`\`\`

Outer tag pins the origin; inner tag marks that the words are exact. Use the
inner \`{% quote %}\` **only** for the *user's own words*, never for a document
excerpt you're pointing at — that goes in the source body (see anchoring, next).
A bare \`{% source %}\` (no inner \`{% quote %}\`) holds content *from* the source in
its body; \`usage\` says how faithful — paraphrase, summary, or a verbatim excerpt.

### Anchoring an existing span (\`pos\`, \`version\`, \`href\`)

When you're citing a *specific span of a specific version* of a file — as in a
commentary card built from selections — the span itself is the \`{% source %}\`
**body**, verbatim (escaped to valid Markdoc), *not* an inner \`{% quote %}\`. The
anchor also carries:

- \`pos\` — a rough locator. **Identical in form and meaning to the \`pos\` on
  \`<user-selection>\` and \`<card-activity>\`** — same grammar (section, nearest
  heading + \`#id\`, paragraph, approximate line), fully cross-referable. When
  you carry a selection into an anchor, copy its \`pos\` verbatim.
- \`version\` — space-separated \`kind:value\` markers pinning the file state
  you anchored against: a \`sha256:\` content hash (the drift signal) and
  optionally a \`git:<rev>\` (for later diffing). Measure these; don't invent.
- \`placement\` — same field as on a \`<user-selection>\`: present when \`pos\` was
  estimated, so a reader treats the spot as approximate. Copy it through too.
- \`href\` instead of \`ref\` for an **external** target (a full URL: \`file:\`,
  \`http(s):\`) — exactly one of \`ref\`/\`href\`, never both. \`href\` targets are
  not tracked or rewritten by \`bbx mv\`.
- \`retrieved\` — for an external \`href\`, the date you checked the source, in
  date-only ISO form (\`YYYY-MM-DD\`). Set it when capturing facts from a web
  page so a later reader can judge their currency. It is optional because older
  citations and stable local \`file:\` targets may not have a useful check date.

### When to skip the tag

Your own framing prose — connective tissue, transitions, your read
of what something means — doesn't need a \`{% source %}\` tag. The tag
marks the spans that *came from somewhere else*. The rest is yours.

### Never write the \`[→ …]\` bracket form

In compiled context (your briefing include), a \`{% source %}\` tag may appear
downgraded to \`[→ name: usage]\` — that bracket form is **generated output**
for plain-markdown surfaces, never a syntax you write. If you imitate it in
chat or a card it renders as literal brackets. Cite with the real tags — chat
and card views render \`{% source %}\` as a proper citation.`;
}
