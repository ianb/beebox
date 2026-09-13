---
description: "Documentation for Bee Box: a personal assistant built from a coding agent and a folder of files you own, its design choices, and the ways you use it."
---
A few ideas run through Bee Box. An assistant should accumulate, and you
should be able to see not just what it knows but how that came to be, in a
history you can read. For the same reason the system is open source, so
that it can view and understand its own mechanics. Data is typed, a recipe
as a recipe, a person as a person, and it always has room for natural
language alongside the fields, so nothing is lost for not fitting a type
yet, and a fact can carry where it came from and whose words it is. Putting
things in should be easy and expressive: voice, camera, a gesture on a
phone, a clipped page, a chat, each suited to a different kind of thing you
might want to keep. And you should be able to review and refer back to what
is there, with the assistant alongside you.

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
