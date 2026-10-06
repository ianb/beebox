---
title: "A publication lives in two unconnected places: source in src/publications/, control card in _content/publications/"
workstream: publication-home
needs: [decision]
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-static-markdown-publish — explaining where publications live after Markdown rendering landed
priority: normal
---

One publication has two box locations that do not refer to each other.

- The source is `src/publications/<name>/`: `publication.json` (with `pubId`)
  and `site/` or `project/`. Prepare reads only this fixed location
  (`beebox/src/publish/prepare/definition.ts`).
- The control surface is a `publication` card that prepare creates on first
  run at `_content/publications/<pubId>.publication.card`
  (`beebox/src/publish/publication-reference-card.ts`,
  `beebox/src/shared/publication-card.ts`). It holds only `pubId`, a title, and
  a body. Its renderer shows the review and serving controls from the server.

The boxholder expected the card to be the publication, placed anywhere in the
box. Instead the card is a pointer to server state, and the content it controls
lives in a folder the card does not name. The link between them is the shared
`pubId` only. The card can move, but the source cannot. The card name is
`<pubId>`, not the site name. This is indirect and its purpose is not clear to
the boxholder.

## Why it is this way

`beebox/docs/plans/publication-approval-card.md` added the card so review would
be card-centered, without moving approval or serving authority into
box-editable data. The source folder came earlier, from
`beebox/docs/plans/publish-sites-admin.md`. That plan fixed the source root so
the server can derive it and so the build and leak scan have one clear
boundary. The two plans did not join the two locations.

## Tension

- Server-owned authority (approval, audience, host) must stay out of
  box-editable files. Any merge keeps that boundary.
- A fixed source root is simple for the server to derive and scan. A card
  "anywhere" needs a rule for where its site files are and what may ship.
- A card is the normal box unit. The boxholder finds, moves, and links cards.
  A folder plus a JSON file is a developer shape.

Questions to decide:

- Is the card the publication's home, with its definition fields (`content`,
  `tier`, `slug`, `title`) as card fields and the site files beside it? Or does
  the source folder stay, with the card inside it?
- If cards can be anywhere, how does prepare find a publication by name, and
  how does the bundle boundary stay clear?
- What migrates on existing boxes (`publication.json` files, existing reference
  cards)?

## Related

- A third, older mechanism, `bbx pub draft` with `_publish/<pub-id>/`, was
  retired 2026-10-02.
- [Static publications render Markdown](../closed/features/2026-10-02-static-publications-render-markdown.md)
  made a site of `.md` documents simple to write, which makes a
  card-shaped publication more natural.
