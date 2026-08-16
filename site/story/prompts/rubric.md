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
   one lint rule never makes the cut, "all the lint rules" might). Worked
   example: a doc mentions that YAML parsing runs in strictest JSON-only
   mode — alone, a config detail; tagged `strictness-posture`, it joins the
   no-default-parameters lint rule and fail-closed auth as one story about
   a project-wide bias toward strict. Seed accumulator tags (extend
   freely): `strictness-posture`, `git-as-database`, `agent-legibility`,
   `honest-cost` (the project's habit of arguing against itself in its own
   documents).
8. **Future-shaping** — tensions or intentions that say what the project is
   becoming.

Err **generous** at the margin: emit a candidate you're unsure about rather
than dropping it, and mark it `"confidence": "generous"`. But generosity
means keeping borderline *beats*, not slicing one beat into several nuggets:

- **One nugget per story beat.** If two candidate nuggets would appear in
  the same paragraph of a story, they're one beat — merge them (widen the
  span or pick the strongest sentence) rather than emitting slices.
- **Budget by document size**: a ~30-line document usually holds 1–3 beats;
  ~100 lines, 3–8; ~500+, scale accordingly. Exceeding the budget is
  allowed only when the extra nuggets are genuinely distinct beats.

Avoid the known failure modes: **tediously conventional** nuggets (true of
any project — "it has tests", "docs matter"; a principles doc stating a
standard industry piety is NOT a nugget unless the document gives it an
unusual twist, force, or consequence), **span sprawl** (grabbing whole
sections when a sentence carries the idea), and **misreading** (a gloss the
span doesn't support).

**Deficiency-restated-as-significance** (the most important false positive).
Much of this repo is an *issue tracker*: documents that describe gaps, bugs,
and rough edges the project hasn't polished yet. The distinction that matters
is **deficiency vs. tension** — and it is NOT the same as resolved vs.
unresolved:

- **A deficiency is not a nugget.** "X doesn't work well," "X is missing,"
  "X fails silently," "we haven't built X" — a thing that is merely
  incomplete or broken. Dressing it in a gloss that calls it "notable" or
  spins it against the project's usual stance is a false positive. (E.g.
  "new boxes have no secrets and features fail silently, with no provisioning
  mechanism" — that's a to-do, not story.)
- **A genuine tension IS a nugget**, even unresolved, even from in-progress
  work. A tension is a real conflict between goods — two things the project
  wants that pull against each other, a tradeoff with no clean answer, a
  design pressure it is actively holding. In-progress work often *exposes*
  tensions worth discussing (criterion 8, and often 2/3). "We want boxes
  isolated but they share one origin"; "automatic X would fight the
  never-ambient stance" — these are story. The test: is there a real
  competing-goods conflict here, or is this just something that isn't
  finished?

So: a decision made with reasoning (criterion 2), a stated future direction,
or a genuine live tension (criterion 8) are all story. A plain "doesn't work
yet" is not. When a document is only an unpolished-deficiency report with no
decision, direction, or real tension in it, the honest result is few nuggets
or none — don't manufacture significance the document doesn't carry.

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
