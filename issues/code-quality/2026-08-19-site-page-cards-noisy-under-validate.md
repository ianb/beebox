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
