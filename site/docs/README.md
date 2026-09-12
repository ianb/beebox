---
description: "Documentation for Bee Box, a self-hosted personal assistant that a coding agent operates over a directory of markdown cards."
---
Bee Box is a personal assistant system that runs on a computer the user
controls, operated by a coding agent (Claude Code or Codex). The user feeds
it inputs: voice memos, emails, photographs, web clippings, chat messages.
The agent turns those into cards, takes the actions it understands, and asks
a question when it does not. A box is the data: one directory on disk, also a
git repository, holding the cards, the configuration, and the state. A card
is one file with YAML frontmatter validated against a schema plus an optional
markdown body. The filesystem is the state, git is the history, and the `bbx`
command operates a box underneath the web interface and chat.

It fits someone who already runs a coding agent, has a machine that stays on,
is comfortable with files and git, and wants an assistant whose memory is
plain files they own. It does not fit someone who wants an app to sign into,
who would use it from a phone alone, or who wants a finished product: Bee Box
is early, source-available under GPLv3, built by one maintainer, and changing
fast. There is no hosted service and no published container image.

It requires a machine that stays on, either a local Mac or Linux computer or
a small VPS; a Claude Code or Codex login of the user's own, which is the
running cost, since every agent turn consumes model usage; Docker for the
container install path, or Node 24 and several system binaries from source.
Each connector needs its own account. The agent runs with real filesystem and
shell access to the box, without a tool allowlist.

These pages are written for a model reading on someone's behalf. Files are
named for the question they answer, numbered where order matters. Every
directory has an `index.md` listing its files with one line each. Cite the
page a claim came from. When a page does not cover something, say that the
documentation does not say, rather than guessing.
