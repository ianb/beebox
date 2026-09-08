---
title: "Chat history written before the one-root migration references /store/… paths, so its images and links 404"
workstream: box-layout-criteria
area: beebox
priority: important
labels: [chat, migration, box-shape]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "The images in this chat aren't displaying, but it seems like they should?"
---

In a chat on a box migrated to the one-root layout, images in older messages
show the "Failed to load" placeholder while newer ones render. The difference
is the path the message's markdown carries:

- Messages from before the migration: `![…](/store/activities/…/x.image.card)`
- Messages since: `![…](/_content/activities/…/x.attach/x.webp)`

The migration moved `store/` (and `box/`, `people/`, `docs/`, `tmp/`,
`config/`, `tricks/`) under the v3 areas and rewrote refs inside box content,
but a chat transcript is not box content: it lives in the engine's session
store, and nothing rewrote it. The resolver (`src/shared/ref-path.ts`,
`view-url.ts`'s `resolveImageSrc`) resolves `/store/…` literally, the file and
image routes look for a directory that no longer exists, and the card fetch
behind an `.image.card` embed 404s. Every pre-migration message with an image
or a card link is affected, on every migrated box, forever — history does not
age out.

Reproduce: open a chat that predates the box's migration and contains an
image or card link; six of eight images failed in the reported one.

Fix directions, the live layout stream's call:

- **Resolve legacy prefixes at read time.** When a ref's first segment is a v2
  top-level area and the literal path does not exist, map it with `mapV2Path`
  (`core/migrations/one-root-mapping.ts`) and serve the v3 location. That
  covers transcripts, old bookmarks, and anything else outside the box that
  holds a pre-migration path, in one place — but the mapping table is
  backend-only today, and links resolve in the frontend too.
- **Or rewrite the transcripts** once, as the migration did for content: a
  session-store pass over every message body. Exact, but it edits history and
  has to run on every engine's store (Claude JSONL, Codex sessions).

Either way, `bbx validate`'s ref checks should not consider a v2-shaped ref in
a transcript broken until this is decided.
