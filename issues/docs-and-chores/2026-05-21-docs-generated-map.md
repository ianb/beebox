---
title: "docs generated map"
workstream: unknown
needs: [design]
area: callback-box
---

The per-box `docs/generated/` tree is fully templated from this repo by `cb init` / `generateDocs` — every box gets the same contents. The recursive box-side MAP generator hides this subtree (it's not box-specific information), so agents working in a box currently have no index of what's in `docs/generated/`.

The right place to produce that index is here in `callback-box`, as a build step that emits a `MAP.md` (or a small set of them) alongside the generated content. `cb init` copies the MAP along with everything else. Single source of truth, no per-box churn.

Open questions: where the generator lives (a new script under `src/dev/`? part of an existing generator?); whether it covers just the top of `docs/generated/` or recurses; whether it ships in this repo's `templates/` or is computed at `cb init` time from the templates directory.
