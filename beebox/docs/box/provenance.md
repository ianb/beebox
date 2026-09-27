---
read-when: Writing content derived from or quoting another card, file, person, or external page — the `{% quote %}` and `{% source %}` tags, `ref`/`href`, `usage`, and anchoring a span.
---

# Quotes and provenance

Two body tags keep a card honest about where its words came from.
`{% quote %}` marks a person's exact words; `{% source %}` marks content that
came from another card, file, or page. The rule behind `{% quote %}` is
THE_LAW_OF_QUOTING in the agent guide; this doc is the mechanics.

## DIRECT_QUOTES

THE_LAW_OF_QUOTING says *never paraphrase the user*; `{% quote %}` is how
you carry exact words from any person. Mark a verbatim span with it so the words stay
visibly distinct from your paraphrase — inline within a sentence, or as a block:

```
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
```

You choose *which* spans to quote, and may trim to the core, split across tags, or
move a quote between cards — but the text inside the tag is the user's exact
words. (The full rule, and the temptations to resist, are in
THE_LAW_OF_QUOTING.)

For the **user's own words**, omit `from`: their voice is the default protected
by THE_LAW_OF_QUOTING. When quoting a third party — a studio owner, an
interview subject, or attributed website copy — set `from="…"` to the speaker
or author. The renderer shows that attribution, keeping the third party visibly
distinct from the user's voice. Write a human-readable attribution in `from`.

A document span you're anchoring a comment to — an excerpt you're *pointing at*,
not a person's words you're recording — is not a quote: it goes in a
`{% source %}` body (see PROVENANCE).

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

See `node_modules/beebox/box-docs/narration-mode.md`.

## PROVENANCE — the `{% source %}` tag

When you write content that's derived from another card or file —
a summary of a memo, an inference from an email, a name pulled from
a transcript — wrap it in a `{% source %}` tag so the origin stays
visible. The complement to `{% quote %}`: where `{% quote %}` answers
*whose exact words*, `{% source %}` answers *where the content came
from*, optionally *how* it was derived.

```
{% source ref="/_content/inbox/Voice_2026-03-15.memo.card" usage="summary" %}
She's been going back and forth on the kitchen — open shelves vs.
closed, mostly because she doesn't trust herself to keep them tidy.
{% /source %}

{% source ref="/_content/people/Dana_Lee.person.card" usage="inferred from her email signature" %}
Dana lives in Portland.
{% /source %}
```

### `ref` — pointing at another card

`ref` is the box's pointer to another card, used throughout the guide:
frontmatter (`{ref: "..."}`, `key-people[].ref`), body links, and tags
like this one. How to write the path is the **refs** bullet in the guide's
ABOUT_CARDS section.
Refs are tracked automatically — `bbx validate` warns when a `ref` no
longer resolves, and `bbx mv` rewrites them when the target moves. Inside
`{% source %}`, exactly one of `ref` / `href` is **required** — it names
where the wrapped content came from.

### `usage` — how the source was used

Optional, free-form natural language describing *the way the source material
was used* to produce the wrapped content. Not an enum — write the truth.

Examples spanning the range:

- `usage="verbatim"`
- `usage="paraphrase"`
- `usage="summary of the third section"`
- `usage="calculated from the figures in the table"`
- `usage="inferred from Dana's preference for X"`
- `usage="extracted name"`
- `usage="agent's own framing based on the conversation"`

Honest description beats enum-fitting. If the derivation has a
specific shape, name it. If it's just "summarized," say so. Don't
collapse everything into `verbatim` or `paraphrase` when the truth
is sharper.

### Composition with `{% quote %}`

The two tags compose to express "verbatim from there":

```
{% source ref="/_content/inbox/Voice_2026-03-15.memo.card" usage="verbatim" %}
{% quote %}I keep going back and forth on the kitchen.{% /quote %}
{% /source %}
```

Outer tag pins the origin; inner tag marks that the words are exact. Use the
inner `{% quote %}` **only** for the *user's own words*, never for a document
excerpt you're pointing at — that goes in the source body (see anchoring, next).
A bare `{% source %}` (no inner `{% quote %}`) holds content *from* the source in
its body; `usage` says how faithful — paraphrase, summary, or a verbatim excerpt.

### Anchoring an existing span (`pos`, `version`, `href`)

When you're citing a *specific span of a specific version* of a file — as in a
commentary card built from selections — the span itself is the `{% source %}`
**body**, verbatim (escaped to valid Markdoc), *not* an inner `{% quote %}`. The
anchor also carries:

- `pos` — a rough locator. **Identical in form and meaning to the `pos` on
  `<user-selection>` and `<card-activity>`** — same grammar (section, nearest
  heading + `#id`, paragraph, approximate line), fully cross-referable. When
  you carry a selection into an anchor, copy its `pos` verbatim.
- `version` — space-separated `kind:value` markers pinning the file state
  you anchored against: a `sha256:` content hash (the drift signal) and
  optionally a `git:<rev>` (for later diffing). Measure these; don't invent.
- `placement` — same field as on a `<user-selection>`: present when `pos` was
  estimated, so a reader treats the spot as approximate. Copy it through too.
- `href` instead of `ref` for an **external** target (a full URL: `file:`,
  `http(s):`) — exactly one of `ref`/`href`, never both. `href` targets are
  not tracked or rewritten by `bbx mv`.
- `retrieved` — for an external `href`, the date you checked the source, in
  date-only ISO form (`YYYY-MM-DD`). Set it when capturing facts from a web
  page so a later reader can judge their currency. It is optional because older
  citations and stable local `file:` targets may not have a useful check date.

### When to skip the tag

Your own framing prose — connective tissue, transitions, your read
of what something means — doesn't need a `{% source %}` tag. The tag
marks the spans that *came from somewhere else*. The rest is yours.

### Never write the `[→ …]` bracket form

In compiled context (your briefing include), a `{% source %}` tag may appear
downgraded to `[→ name: usage]` — that bracket form is **generated output**
for plain-markdown surfaces, never a syntax you write. If you imitate it in
chat or a card it renders as literal brackets. Cite with the real tags — chat
and card views render `{% source %}` as a proper citation.
