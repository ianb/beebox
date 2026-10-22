---
title: "docs generated map"
workstream: unknown
needs: [design]
area: beebox
---

The per-box `docs/generated/` tree is fully templated from this repo by `bbx init` / `generateDocs` — every box gets the same contents. The recursive box-side MAP generator hides this subtree (it's not box-specific information), so agents working in a box currently have no index of what's in `docs/generated/`.

The right place to produce that index is here in `beebox`, as a build step that emits a `MAP.md` (or a small set of them) alongside the generated content. `bbx init` copies the MAP along with everything else. Single source of truth, no per-box churn.

Open questions: where the generator lives (a new script under `src/dev/`? part of an existing generator?); whether it covers just the top of `docs/generated/` or recurses; whether it ships in this repo's `templates/` or is computed at `bbx init` time from the templates directory.
