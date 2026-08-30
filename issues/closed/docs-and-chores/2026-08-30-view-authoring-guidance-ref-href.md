---
title: "In-box view authoring guidance: use ref/href conventions in view data, not ad-hoc url arrays"
workstream: link-vocabulary-guidance
area: callback-box
labels: [views, agent-guidance]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder saw a view built with a bare urls string array"
resolution: implemented
---

Resolved by adding the current `ref`/`href` object-envelope vocabulary to
the always-loaded card guide and the generated view-authoring reference. Two
direct-knowledge audits cover internal refs and external source envelopes. The
schema-side standardization decision remains parked; this change does not rename
fields or migrate card data. No validator warning was added: detecting an
intentional bare-string URL array without false positives is not a small change,
and the requested guidance plus audits cover this workstream's scope.

When a box agent builds a custom view, nothing steers it toward the repo's
field conventions, so it invents shapes — the observed case:
`urls: ["https://…"]` where the convention is `sources: [{href: "…"}]`
(objects carrying context, extensible with `retrieved`, `usage`, and — per
the recurrence-envelope discussion — whatever siblings the value needs; the
same instinct as ref-carrying objects).

The ask is **instructions**, in the surfaces a view-building agent actually
loads:

- Wherever view authoring is taught (the views section of the agent guide /
  `skills-content.ts` — locate the actual authoring guidance, not just the
  debugging tips), add the field-shape rules: internal targets are `ref`
  (rewritten by `cb mv`, rendered as links, walked by ref-fields); external
  targets are `href` inside an object envelope (`sources: [{href, retrieved,
  note}]`), never bare-string url arrays; dates date-only ISO, rendered as
  prose.
- One worked example that models it (examples do double duty — show the
  envelope AND a ref side by side).
- A `knows_directly` knowledge-audit entry, run, per the convention-without-
  an-audit rule.
- Worth considering while in there: does `cb view check`/validate have any
  opinion on data shapes, and should it nudge (a warn on `^urls?:` string
  arrays is cheap and targeted — but that's lint-adjacent, keep it a warn).

Boxholder generalization (same day): **schema link fields should rhyme with
`{% source %}`** — the same attribute names (`ref` / `href` / `usage` /
`retrieved` / `version`), the same envelope shape, whether the link lives in
a tag, a card field, or view data. One vocabulary across the three surfaces,
so an agent that learned the tag already knows the field. That widens this
item beyond view guidance: the standardize-card-provenance decision
(`../decisions/2026-08-09-standardize-card-provenance-field.md`) is the
schema-side half — its four provenance spellings (`source:` string,
`RecipeSource`, `link`, `from`) are exactly the rhyme failing — and whoever
takes either should take both, with `{% source %}`'s attribute set as the
tuning fork.

Related: `2026-08-29-rrule-as-universal-field-convention.md` (the envelope
instinct generalized), `2026-07-22-embed-json-schema-in-card-docs.md` (schema
into agent docs), the `{% source %}` retrieved/href work (landed 2026-08-29)
that makes the href-object convention worth pointing agents at.
