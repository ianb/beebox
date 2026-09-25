---
title: "Box-authored site pages are permanently noisy under cb validate"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-public-site — box-authored site page experiment
priority: important
---

A box authoring site pages (the box-as-CMS direction — see
[the exploration issue](../exploration/2026-08-19-site-authored-in-a-box.md))
trips two warning classes on every `cb validate`:

- card-lint's ref-walker reads `{% aside ref="why-it-asks" /%}` as a box
  path reference → `Broken reference at body:…:aside.ref`. The site
  vocabulary's attribute name collides with the box's ref vocabulary;
  renaming the attribute (anything but `ref`) is the cheap fix.
- The generic Markdoc body pass reports `Undefined tag: 'aside'/'nugget'` —
  the site tags aren't registered in the box's Markdoc config. Needs either
  box-side tag registration (schema-adjacent?) or a way for a schema to
  declare its body's tag vocabulary.

All warnings, nothing blocks — but "noisy command output is a bug," and this
noise recurs on every validate of every site card.

## Scoped 2026-09-12 — bigger than it looks, and it has a live owner

Looked at this as a candidate small fix and put it back. Both halves are
schema-surface work, not local patches:

- `core/body-markdoc-lint.ts` validates EVERY card body against the single
  shared `markdocConfig` (`shared/markdoc-config.ts`). A box that authors its
  own tags has no way to extend that vocabulary, so the fix is a new schema
  field declaring a body's tags plus threading it through card-lint — a
  `cardSchema()` surface change, with the migration questions that implies.
- The `aside.ref` collision is the same shape from the other side: the ref
  walker treats any `ref` attribute as a box path. Renaming the site
  vocabulary's attribute is cheap in isolation but changes the site's authored
  vocabulary, and `site/` currently has a LIVE workstream (`public-site`)
  reworking exactly that surface.

Confirmed still reproducing: a box authoring site pages today emits
`Undefined tag: 'aside'/'nugget'/'expand'/'agent-prompt'` plus
`Broken reference at body:…:aside.ref` on every validate — four tag names now,
not two, since `agent-prompt` joined the vocabulary.

Suggest routing to `public-site` (or whoever lands the site vocabulary) rather
than picking it off the queue, and doing the schema-declared-tags half
deliberately.
