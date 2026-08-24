---
title: "bin/exhibits add accepts a .md file and renders an exhibit with no content"
workstream: streams-and-issues
area: bin
filed-by: agent
discovered-in: worktree-user-stories-refresh — exhibiting a proposal doc for review
priority: normal
resolution: implemented
---

`bin/exhibits add … doc.md` copies the file into the exhibit directory under its
own name and adds nothing to the manifest, so the page renders only the ask
prose. The exhibit looks fine from the CLI — it prints a URL and reports
`figures: 0` — and looks empty to the developer opening it.

Observed: an 11 KB proposal document exhibited as
`user-story-journeys-the-shape-before-i-build-any`. The directory held
`user-story-journeys.md`, the manifest had no `figures` key, and the page showed
a single paragraph (the `--prose`). Renaming the file to `doc.md` by hand is the
fix, because that is the name the app renders with Markdoc
(`workstreams-app/docs/exhibits.md`: "`doc.md` — optional prose, rendered with
Markdoc").

`figures: 0` is the tell, but it reads as normal for a document-only exhibit
rather than as "your content went nowhere".

Two candidate behaviours, either better than the current silence:

- a single markdown argument lands as `doc.md`
- a non-image argument that the manifest cannot reference is refused, naming
  `doc.md` as the destination for prose

The second generalises better: the same silent drop presumably applies to any
file type that is neither an image nor a page.

## Resolution

One `.md` or `.markdown` argument now lands as the canonical `doc.md` that the
default renderer consumes. The CLI refuses multiple Markdown documents before
creating the exhibit directory, and its progress line reports `document:
true|false` alongside the figure count. Arbitrary non-document sibling files
remain supported as assets for custom `index.html`/`index.tsx` pages.

The existing CLI doctest now verifies the mixed document-plus-figures path,
the rendered filename, the progress diagnostic, and the fail-closed
multiple-document case.
