---
title: "Static publications render Markdown automatically: a site folder of .md files publishes as HTML"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked for a lighter way to publish a Markdown file
---

To publish one Markdown document, the agent must convert it to HTML by hand.
Static mode publishes `src/publications/<name>/site/` verbatim and requires a
root `index.html` (`beebox/src/publish/prepare/files.ts:177`). Static mode
already allows `.md` files, but it serves them as raw text.

Job to be done: the boxholder has one or several Markdown documents and wants
them on the web with the box's look. The agent should write the documents,
not an HTML conversion.

## Wanted

Rendering is transparent. In static mode, prepare renders each `.md` source
to HTML. The author writes no flag and no build step.

- `foo.md` renders to `foo.html`. `index.md` renders to `index.html`, so it
  satisfies the root `index.html` rule.
- A site can have several documents. The index (`index.md` or a hand-written
  `index.html`) links to them.
- A relative link to `bar.md` from a rendered document points at `bar.html`
  in the output.
- An explicit `foo.html` next to `foo.md` takes precedence, or is an error.
  Choose one and document it.
- The leak scan and file summary operate on the rendered output, so member
  review sees what is served.

## Existing pieces

- `beebox/src/publish/draft/render-docs.ts` renders one Markdown/Markdoc doc
  to a self-contained `index.html`: the box's own Markdoc config, inline CSS,
  no JavaScript, images inlined or copied to `assets/`. It belongs to the older
  `bbx pub draft` flow. It resolves image references as box paths
  (`/_content/...`); a site folder needs references relative to the `.md`
  file. It emits one page; multi-document output and `.md` → `.html` link
  rewriting are new.
- `beebox/src/publish/prepare/core.ts:57-62` already uses a task temp
  directory. Static mode can copy `site/` there, render, and hand the result to
  `collectPublicationFiles` unchanged.

## Open questions

- Whether the source `.md` also ships next to its `.html`. Default: no.
- Shared styling across documents: one inline style per page (current
  renderer) or a shared stylesheet.
- Agent guidance: `docs/box/publishing.md` ("Static files") and the installed
  publication guidance must say that `.md` renders. A knowledge audit should
  confirm a box agent picks the Markdown path for a document request.
