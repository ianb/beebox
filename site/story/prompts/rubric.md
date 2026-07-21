# Story-nugget rubric (shared by all prompt variants)

You are extracting **story nuggets** from one document in the callback-box
repository. A nugget is raw material for telling the story of this project —
why it is what it is, what it is becoming, and the structure that fits it
together. The reader we ultimately serve should feel a bit of surprise, or
feel the structure click.

## What "interesting" means (the criteria)

Claim one or more criterion numbers per nugget:

1. **Unconventional choice** — the project deviates from standard practice,
   with reasoning (e.g. filesystem as database, git as history).
2. **Decision with reasoning** — a call that was made and what it traded
   away; reversals and roads-not-taken are especially valuable. History is a
   primary story vehicle.
3. **Non-obvious design purpose** — a feature whose *why* is not visible
   from its *what*.
4. **Simple-but-load-bearing** — a small mechanism carrying heavy values
   weight, regardless of how technically simple it is.
5. **Unique/interesting mechanism** — something few other systems have.
6. **Distinctive development practice** — how the project is *built*, when
   the practice itself is telling.
7. **Cross-cutting accumulator** — an instance too small to stand alone but
   part of an aggregate that matters (tag it so instances can pile up; e.g.
   one lint rule never makes the cut, "all the lint rules" might).
8. **Future-shaping** — tensions or intentions that say what the project is
   becoming.

Err **generous**: emit a candidate you're unsure about rather than dropping
it, and mark it `"confidence": "generous"`. Precision gets tuned later;
missed material is the worse failure this round.

Avoid the known failure modes: **tediously conventional** nuggets (true of
any project — "it has tests", "docs matter"), **span sprawl** (grabbing whole
sections when a sentence carries the idea), and **misreading** (a gloss the
span doesn't support).

## What an item is

One idea per nugget. Fields:

- `slug` — short kebab-case id, descriptive.
- `span` — a **verbatim, contiguous quote** from the document, copied
  exactly (whitespace and punctuation included). The smallest quote that
  carries the idea: guideline ≤ 25 lines, hard cap 40. It must appear in the
  document character-for-character — spans are mechanically verified and a
  non-matching span is discarded as fabrication.
- `gloss` — ≤ 2 sentences: what this nugget is and why it's interesting.
  Working notes for the editor, never published.
- `tags` — kebab-case topical tags; include cross-cutting accumulator tags
  where criterion 7 applies.
- `criteria` — the claimed criterion numbers (array of integers).
- `confidence` — `"strong"` or `"generous"`.

## Output format

Your final message must be ONLY a JSON object, no prose before or after:

```json
{"nuggets": [{"slug": "...", "span": "...", "gloss": "...", "tags": ["..."], "criteria": [1], "confidence": "strong"}]}
```

An empty result is `{"nuggets": []}` — a thin document honestly yielding one
or two nuggets is a better outcome than padding.
