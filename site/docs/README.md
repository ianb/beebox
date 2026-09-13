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

## What it is for

It works well as a place to put things you do not yet know how you want
to keep. You start by putting stuff in: a shoebox of receipts, a pile of
papers, the contents of a shelf, whatever is in your head after a walk.
It becomes records you can ask about, in effect a database you never had
to design. As you use it, the organization that fits what you actually put
in emerges, and the box takes that shape.

It also synthesizes: notes and thoughts talked through over weeks come back
as something you can read, with the todos and open questions pulled out.
And it keeps literal track of what you said versus what it thought: your
words are kept as your words, and the assistant's inferences are marked as
its own, so you can always tell the two apart.
Email is handled from within the box, with replies drafted for you. Recipes
scale; people and places are recognized; a project gets a working memory;
something you are learning gets a course built for it. And what you correct
stays corrected. Each of these has a page under "uses" below, including what
is still rough.

Alongside those ideas, a few choices. The assistant is a coding agent,
Claude Code or Codex, rather than something built here: you bring your own,
very possibly one you already pay for, and the progress in those tools is
not something Bee Box tries to compete with. The engine that hosts the
agent is kept separate from it, so a different agent can be swapped in
later. Inside, everything has a schema, and every card is also a container
for other files: a photo, a recording, a PDF, a document travels with the
card it belongs to. Links between cards are parsed and checked, and follow
files when they move; the box is hypertext, and it stays coherent as it
grows. Email and calendar act as triggers as well as sources. And all of
it is extensible from inside: how a kind of card is shown, how it is
interacted with and updated, what kinds exist at all. The agent can build
those things and can also read them to understand how the box works.

Mostly you use it through chat, in a web app on desktop and phone, typed or
spoken, with the box's contents a click away: the questions waiting on you,
a map of its notable places, the history of changes, and a display for each
kind of thing. The more distinctive input is long-form: talking at length
into the phone app or the capture page, photographing things while saying
what they are, scanning paper, and clipping the page you are reading with
the browser extension. That part is not fully baked (telling speakers apart
in a recording is hard, for one), but there is a lot there and more coming.
A Telegram connection exists and is rough. Connectors sync Gmail, Google
Calendar, and Google Drive.

It runs on a computer you keep on, with your own coding-agent login, and it
is early: self-hosted, one maintainer, changing fast. Besides the model
provider behind the coding agent, which sees every agent turn, the outside
AI services are ones you choose to configure: transcription (Mistral,
Deepgram, or OpenAI), spoken replies (OpenAI, or Gemini through OpenRouter),
embeddings for search (OpenAI), and Gemini for a few audio and scanning
tasks; the contributor pages list them in full. It is also developed
in an unusually agentic way, with coding agents doing much of the work
under the maintainer's direction, and the plans, issues, and process kept
in the repository; the contributor entry point describes it. The pages
under "Start here" say who it fits and what it requires.

These pages are written for a model reading on someone's behalf. Say things
in the person's terms; keep file formats and code for when they ask or are
clearly technical, since the `reference/` and `dev/` pages hold that depth.
Open the pages that fit what you know about the person. If they want to read
or change the code, also read https://beebox.run/llms-dev.txt, the
contributor entry point. When a page does not cover something, say that the
documentation does not say, rather than guessing.
