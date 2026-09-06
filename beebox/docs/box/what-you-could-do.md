---
title: What you could do with your box
read-when: The user asks what the box can do, what to try, what it is for, or how to get started — or clicks the stock "What can you do?" opener.
---
# What you could do with your box

This is for you, the box's agent, to draw on when someone asks what the box
can do or what they could try. It is not a script to read aloud. Pick the two
or three things that fit what this person has to hand and what they came for,
and say them in plain words. Nothing here is something to jump into: when the
person shows interest in one, the next step is to talk about it — what they
want out of it, what they already have, how they'd use it — and only then to
build. Everything here works today. How each mechanism works is in the rest
of these docs and in the agent guide; this file says what a person could do
with it and why they might want to.

## Photograph things, talk about them, and get a record

Three entry points, one arc. This is the input most people try first, so it
gets the most detail.

**Photograph.** A photo attached to a chat message is not a card yet: it
arrives as a file under `_tmp/` (an `[file#N]` token with its
`<attachments>` path), and `_tmp/` is swept after a week. You read it and
decide what it becomes: a card that keeps the image (an image card, or a
record with the photo attached), a fact written onto an existing card, or
nothing kept once it has served its purpose. Say which you did.

A **batch of photos or scans with no words** arrives differently. A
camera-roll dump or a folder dropped in at once comes as an `<upload>`
message pointing at an upload-batch card under `tmp-upload/`, with a manifest
of every file (dozens of items, on the order of 100 MB). Each file is yours
to look at and place: a photo becomes an image card or attaches to a record,
a document becomes a doc card, and the batch card goes away once
`tmp-upload/` is empty. Pages scanned in bulk land as a capture-session card
in `_content/inbox/` with one image card per page; after your annotation pass
each page carries its OCR text and a description, so the stack becomes
searchable. Both are first-class input expecting a reply, and both have their
own card instructions in these docs (`card-upload-batch.md`,
`card-capture-session.md`).

**Photograph and talk at the same time.** Capture is the box's own input, and
the one to show first. The person opens it, takes pictures, and talks while
they do, in as many takes as they like: stop recording, take more photos,
start again. They can say anything about what they are showing you. Details,
opinions, asides, half-thoughts, what it reminds them of, what is wrong with
it. Nothing has to be phrased for the box or fit any expected shape; a stream
of consciousness is the intended input. What you receive is a `<capture>`
message pointing at a capture-session card whose body is a timeline: the
transcribed speech in order, each photo placed where it was taken
(`{% image %}`), the long pauses marked (`{% silence %}`). Words and pictures
arrive together, so you can work out which words go with which photo. The
person's words stay theirs, quoted, on whatever comes out of it.

Where Capture is, if they ask: on a phone it is the camera button on the
composer row (control `bbx-composer-capture`); on a desktop it is inside the
composer's Add menu (control `bbx-composer-add`, which also holds attach and
upload). Before naming a location, run `bbx chat ui` to see what is on their
screen, then link the control and locate it in words in the same sentence,
as the chat prompt's "Pointing at the interface" rules say. For example: "Tap
the camera button at the left of the message box
([Capture](control:bbx-composer-capture)) and start talking as you take
pictures." Or on a desktop: "Open the plus menu beside the message box
([Add](control:bbx-composer-add?action=reveal&description=capture%2C%20attach%2C%20upload))
and choose Capture." Never point at a control the dump did not show.

**Take inventory.** What comes out of a walk like that is a set of records,
one per thing: a name, where it is, dates, quantities, who it belongs to, a
link back to the photo and to the words it came from. That structure is
deliberately loose. The person does not have to know what the box "expects"
or "understands". If they mention that one pan is the good one for baking,
that a bowl was their grandmother's, that the toaster is getting old and
should be replaced, all of it has a home: quoted in the record's body, or as
a note, with no field to fit it into. Do not turn an aside into a checkbox;
keep it as what they said, and let a later question ("what should we
replace?") find it by searching. Records are the general-purpose "a thing I
keep track of" card. Ask "what do we have in the barn" later and the box
answers from them.

## New kinds of things, with their own structure

People keep collections: board games, movies, books, plants, bills, the notes
for a class, every gallery in a city for a site about them. The box can give
each kind its own card type, with its own properties and its own page.

What to tell a person, and how to behave:

- **They never have to design anything.** Nobody needs to know what a schema
  is or decide up front which attributes to track. You propose a reasonable
  set of properties for what they are collecting, and you can add opinionated
  ones (a "would play again" for games, a "who liked it" for films).
- **Anything that does not fit still gets kept.** Say something about an item
  that has no property, and it goes in as words on the card. Later, if the
  same kind of remark keeps appearing, you can turn it into a property and
  move the existing ones over. Properties change over time; nothing is
  locked in.
- **Each thing is also a container.** A plant's card holds the photos taken of
  it week to week; a game's card holds the photo of its box and the person's
  remarks about it. Whatever someone tracks can accumulate things beneath it.
- **Start loose, tighten later.** When the shape is unclear, plain records are
  enough; promote to a type once the same kind of thing keeps coming up.
- **Ask what it is for before building.** Picking a game for tonight, knowing
  what is in the barn, remembering what they thought of a film: the purpose
  decides which properties matter. Talk first; the first card comes after.

The mechanism, for you: a box-local card type is a `.ts` file in the box's
`src/schemas/`, written by you, and it gets its own doc and rules like any
built-in type. A card's attach scope is the container. A collection card
with a custom view is how a shelf of them becomes something to browse and
filter ("what can we play tonight with four people in under an hour").

## Dictation, and keeping your voice

Talking is the way to collect thoughts and reactions: not short commands but
five, ten, twenty minutes of thinking out loud, with pauses of a minute while
the person puts the next thought together. Tell them this is welcome.

What they can expect, and what you owe them:

- **Talk about what is on screen.** With a document or card open, they can
  select a passage and then talk about it, and you see which passage they
  meant, at the moment they said it.
- **False starts are fine.** "Oh no, I didn't mean that" is handled: you keep
  the corrected thought, drop the abandoned one, and what remains is still
  their words.
- **Their words come back as their words.** Cleaned of fillers and restarts,
  arranged, trimmed, but never paraphrased. Not the most literal transcript,
  and not your rewording either. Someone who dictates a page and gets back
  their own sentences, in order, is the thing to show.
- **You never rewrite them.** The law of quoting applies to everything they
  say: their words go inside `{% quote %}`, and edits to those words happen
  only when they ask for them.

The mechanism, for you: live transcription with spoken controls ("send
message", "erase message", "microphone off"); an optional high-quality pass
over the recording before the message goes out; words the recognizer was
unsure of marked so you can go back to the audio when it matters; a
selection made in an open card arriving with the message as
`<user-selection>`. Narration mode is for the long, loose dump: the person
talks, you stay silent and collect.

## Connecting things

The box pulls from services the person connects and pushes back where it
makes sense. Google Calendar syncs two ways: ask what is coming up, add or
move an event by saying so. Gmail brings in the threads they tell it to
track and lets you draft replies they review and send themselves; the box
never sends mail on its own. Google Drive mirrors a folder, a spreadsheet, or
a document into the box and back. Telegram puts the same conversation on a
phone. The browser extension saves pages and comments (below). Connecting
Google needs an OAuth setup that is still fiddly, so lead with the inputs
that need nothing: photos, voice, typing.

## Plans, and keeping track

Plans and lists are things a person keeps track of, and the same freedom
applies: their own properties, their own way of noting progress, kept as
records or as a type of their own. Behind it all is a persistent record:
every change is a commit, so "what did you do overnight" and "why did you
move that" have answers you can trace.

What the box does not yet do well is think ahead: notice on its own that a
plan needs attention, or trigger on something happening. Offer to keep
track, to remind, to run something weekly on a schedule. Do not promise that
the box will anticipate.

## What the agent itself can do

You can search the web and bring back what you find. You can read the
documents and PDFs the person gives you, and search across everything in the
box (`bbx search`), so "research this against what I already have" is a
real request: pull the relevant records, compare, write it up as a card with
sources. You can write a small program when a task repeats (a trick) or a
custom view when a kind of card wants a better display.

## Landmarks and areas

As someone's box fills in, they stop working in the whole box at once and
start working in one area: the games, the renovation, the class. A landmark
marks such an area. It is the way to jump to that spot, to start a chat that
already knows what it is about, and to find the things made there. For a
person who knows ChatGPT or Claude: like a project, with one difference: the
agent can still look anywhere in the box. Suggest a landmark when the same
kind of thing keeps coming up; do not make them for trivia.

## The browser extension

Bee Box Clerk (Chrome) saves the page the person is reading into the box as
a readable copy with a frozen snapshot, or saves it with their comment
attached to the passage they were looking at; the box can open a chat with
that page beside it. It can also share their open tabs so the box can
propose an arrangement they apply. Before offering it, know whether they
have it: if the box has no saved webpage cards, they probably do not yet.

## Gmail and Calendar in particular

Once Google is connected, the two most useful asks are "what is on my
calendar this week" (and "put lunch with Sam on Thursday") and "keep an eye
on this thread" (with replies drafted for review). Both need the Google
setup first, which is the hardest part of installing today; treat them as
the second week, not the first hour.
