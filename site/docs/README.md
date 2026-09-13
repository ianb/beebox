---
description: "Documentation for Bee Box: a personal assistant built from a coding agent and a folder of files you own, its design choices, and the ways you use it."
---
A few ideas run through Bee Box. An assistant should accumulate, and you
should be able to see not just what it knows but how that came to be: the
history of a card, of a decision, of the box itself, is kept and readable,
so you can look back at how things developed. For the same reason the whole
thing is open source: you should be able to see how it works. Things are
represented in sensible shapes, a recipe as a recipe, a person as a person,
and there is always an overflow, so the fullness of what you know is kept
even when it does not fit the shape yet. Where a fact came from, and whose
words these are, can be marked, so the record stays honest. You put things
in explicitly, but there are many convenient ways to do it, from a spoken
remark to a photographed page, and separately there are connectors that
bring email, calendar, and documents in on their own.

The mechanics follow from that. The assistant is a coding agent (Claude
Code or Codex). The engine gives it a box: a folder of cards, each a file
with a checked header and markdown text, kept under git, which is where the
history lives. Every kind of card has a shape; the text is the overflow.
Links between cards are parsed and checked, and follow the files when they
move. A small set of marks in the text carries provenance and lets a task
be noted in place. New input is triaged into the box; the agent's questions are cards; corrections become
rules it reads next time; recurring work runs on a schedule and on what
email and calendar bring in. The agent builds inside the box too: a display
for a kind of card, a dashboard, a routine, a new kind of record. What it
builds is a file, versioned like everything else.

You use it through a web app on desktop and phone: a dashboard of what
needs you, a chat you type or speak into, a browser over everything the box
holds, the questions waiting on you, a map of its notable places, a history
of changes, and a display for each kind of thing. An iPhone app and a capture
page take voice memos, long spoken dumps, photos with spoken remarks, and
scanned paper. A browser extension clips the page you are reading. A
Telegram presence lets a household talk to one box in a chat. Connectors
sync Gmail, Google Calendar, and Google Drive.

It runs on a computer you keep on, with your own coding-agent login, and it
is early: self-hosted, one maintainer, changing fast. The pages under
"Start here" say who it fits and what it requires.

These pages are written for a model reading on someone's behalf. Say things
in the person's terms; keep file formats and code for when they ask or are
clearly technical, since the `reference/` and `dev/` pages hold that depth.
Open the pages that fit what you know about the person. If they want to read
or change the code, also read `llms-dev.txt`, the contributor entry point.
Cite the page a claim came from, and when a page does not cover something,
say that the documentation does not say, rather than guessing.
