---
description: "How the box keeps links, moves, and file shapes honest as it grows, so the filesystem stays hypertext instead of a pile of bytes."
---
# It keeps itself coherent

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates
the box. A box is meant to grow for years, so it is built as hypertext:
cards point at each other, at attachments, and at outside pages, and
filenames carry meaning instead of being arbitrary. The system does the
bookkeeping that keeps hypertext honest, so growth never turns the box into
a pile of files that only look organized.

**What it does for you**

- Every reference in a card, in its header fields or its body text, is found
  and checked, so a dangling reference is a warning you see, not a silent
  hole.
- Move or rename a card and the references pointing at it are rewritten, so
  reorganizing does not leave broken links behind.
- A card is checked against its type on read, again right after an agent
  edit, and again before a commit, so a broken card cannot quietly enter
  the history.
- Attachments live beside their card and travel with it.
- Filenames say what a thing is, so the folder tree itself reads as a map,
  with curated landmarks on top for the spots worth bookmarking.
- A stray file with no business in an attachment folder is caught before it
  is committed.

**How it works, briefly**

One shared rule parses every reference, wherever it appears: a header field,
a line of body text, or an attachment path. It is written from the box
root, or, for a card's own attachments, from that card, and checked against
what exists; one that tries to escape the box is refused. One command
checks the whole box, a list of files, or just what is about to be
committed; another moves a card while rewriting every reference that
pointed at it.

**Limits**

A dangling in-box reference is a warning, not a block, so a reorganization
in progress does not stop a commit. What does block a commit is a card
failing its own schema, or an attachment folder holding an unrecognized
file. Outside web links are checked too, but looser: looked at once, in the
background, the first time one appears, and a dead one is only a warning.

**Go deeper**

[shape-it-later.md](shape-it-later.md),
[../concepts/enriched-markdown.md](../concepts/enriched-markdown.md),
[../concepts/cards.md](../concepts/cards.md),
[../concepts/landmarks.md](../concepts/landmarks.md),
[../contracts/box-layout.md](../contracts/box-layout.md),
[../contracts/card-validation.md](../contracts/card-validation.md),
[../reference/bbx-commands.md](../reference/bbx-commands.md)
(for the curious: `bbx validate`, `bbx mv`)
