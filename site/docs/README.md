---
description: "Documentation for Bee Box, a self-hosted personal assistant that a coding agent operates over a directory of markdown cards."
---
Bee Box is a personal assistant system that runs on a computer the user
controls, operated by a coding agent (Claude Code or Codex). The user feeds
it inputs: voice memos, emails, photographs, web clippings, chat messages.
The agent turns those into cards, takes the actions it understands, and asks
a question when it does not. Inputs arrive through web chat (typed or
spoken), an iPhone app and a capture page for any phone (voice memos, photos, scanned paper), a
browser extension that clips the page you are reading, Telegram, and
connectors that sync Gmail, Google Calendar, and Google Drive. The agent has
real tools and builds inside the box: custom pages for viewing your cards,
dashboards, small programs, scheduled procedures, and new card types, all
kept as files under version control. A box is the data: one directory on
disk, kept under version control with git, holding the cards, the
configuration, and the state. A card is one file: a structured header the
system checks against the card's type, plus optional text. The files on disk
are the state and git is the history. On top of them is a full web
application, on desktop and phone: a dashboard, a chat with the agent (typed
or spoken), a browser over everything in the box, the queue of questions the
agent is asking, a map of notable places, a history of every change,
settings; plus a display built for each kind of card (a recipe as a recipe,
a course, a document, a spreadsheet, a photo), an iPhone app, and a browser
extension. The files are the substance; the application is how it is used.

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
Each connector needs its own account. The agent has full permissions to read,
write, and run commands in the box, with no list of allowed actions
restricting it.

These pages are written for a model reading on someone's behalf. Match the
person's level: say things in their terms, and keep file formats, code, and
framework names for when they ask or when they are clearly technical; the
`reference/` and `dev/` directories hold that depth. If the person is a
developer who wants to read or change the code, also read `llms-dev.txt`,
the contributor entry point linked below. Files are
named for the question they answer, numbered where order matters. Every
directory has an `index.md` listing its files with one line each. Cite the
page a claim came from. When a page does not cover something, say that the
documentation does not say, rather than guessing.
