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
build. Everything here works today; how each mechanism works is in the rest
of these docs and in the agent guide, so this file only says what a person
could do with it and why they might.

Where a passage is the author's own words, it is quoted. Use those words for
the *why*; they are the shape the author wants the idea to have. Restate the
mechanics in your own words.

## Photograph things, talk about them, and get a record

Three entry points, one arc. This section is more detailed than the others
because it is the input most people try first and the one with the most
moving parts behind it.

**Photograph.** A photo attached to a chat message is not a card yet: it
arrives as a file under `_tmp/` (an `[file#N]` token with its
`<attachments>` path), and `_tmp/` is swept after a week. You read it and
decide what it becomes: a card that keeps the image (an image card, or a
record with the photo attached), a fact written onto an existing card, or
nothing kept at all once it has served its purpose. Say which you did.

A **batch of photos with no words** is different. A camera-roll dump or a
folder of scans dropped into the box arrives as an `<upload doc="…">`
message pointing at an upload-batch card under `tmp-upload/`, with a
manifest of every file (dozens of items, on the order of 100 MB); your job
is to file each one to where it belongs and leave `tmp-upload/` empty. Pages
scanned from a desktop uploader (`bbx scan-import`) skip chat and land as a
capture-session card straight in `_content/inbox/` for triage. Both are
first-class input expecting a reply, and both carry their own card
instructions (`card-upload-batch.md`, `card-capture-session.md` in these
docs).

**Photograph and talk at the same time.** Capture is the box's own input,
and the one to show first. The person opens it, takes pictures, and talks
while they do, in as many takes as they like: stop recording, take more
photos, start again. They can say anything about what they are showing you.
Details, opinions, asides, half-thoughts, what it reminds them of, what is
wrong with it. Nothing has to be phrased for the box or fit any expected
shape; a stream of consciousness is the intended input. What you receive is
a `<capture>` message pointing at a capture-session card whose body is a
timeline: the transcribed speech in order, with each photo placed where it
was taken (`{% image %}`) and the long pauses marked (`{% silence %}`). The
words and the pictures arrive together, so you can work out which words go
with which photo. The person's words stay theirs, quoted, on whatever comes
out of it.

Where Capture is, if they ask: on a phone it is the camera button on the
composer row (control `bbx-composer-capture`); on a desktop it is inside the
composer's Add menu (control `bbx-composer-add`, which also holds attach and
upload). Before you name a location, run `bbx chat ui` to see what is
actually on their screen, then link the control and locate it in words in
the same sentence, as the chat prompt's "Pointing at the interface" rules
say. For example: "Tap the camera button at the left of the message box
([Capture](control:bbx-composer-capture)) and start talking as you take
pictures." Or on a desktop: "Open the plus menu beside the message box
([Add](control:bbx-composer-add?action=reveal&description=capture%2C%20attach%2C%20upload))
and choose Capture." Never point at a control the dump did not show.

**Take inventory.** What comes out of a walk like that is a set of records,
one per thing: a name, where it is, dates, quantities, who it belongs to, a
link back to the photo and to the words it came from. That is the structured
part, and it is deliberately loose. The person does not have to know what
the box "expects" or "understands". If they mention that one pan is the good
one for baking, that a bowl was their grandmother's, that the toaster is
getting old and should be replaced, all of that has a home: quoted in the
record's body, or as a note, with no field to fit it into. Do not turn an
aside into a checkbox; keep it as what they said, and let a later question
("what should we replace?") find it by searching. Records are the
general-purpose "a thing I keep track of" card. Ask "what do we have in the
barn" later and the box answers from them.

## New kinds of things, with their own structure

> For instance, we did a project where we wanted to create a site with all
> the galleries in all the Twin Cities. And so there's a special kind of card
> for that. Board games, movies. We can keep track of things that we own,
> and you can add to them.
>
> One of the important parts is you don't have to come up with a careful
> schema or something. You don't have to know what a schema is. The agent can
> start with a reasonable set of properties that you're going to collect. You
> can also collect stuff that's not part of that, and it can go back and
> refactor it. You don't have to decide exactly what attributes you have to
> keep track of. You can change those in the future. You can add opinionated
> ones.
>
> You can keep track of your plants. And then each plant, when you take a
> picture of it, they can file that alongside the plant. Anything that you
> keep track of also becomes a container for other things. A plant might
> become a container for when you track it week to week. You can keep track
> of bills coming in. You can keep track of notes or classes. They can just be
> set up as records and then eventually changed as well. So it's really
> flexible how you use that.

The mechanism, for you: a box can define its own card types (a `.ts` file in
the box's `src/schemas/`, written by you, with fields the person actually
wants), and each type gets its own doc and rules. Before defining anything,
find out what they want to do with the collection — pick a game for tonight,
know what's in the barn, remember what they thought of a film — since that
decides which properties matter. Start with records when the shape is
unclear; promote to a type when the same kind of thing keeps coming up. A
card's attach scope is the "container": a plant's weekly photo files beside
the plant. A collection card with a custom view is how a shelf of them
becomes something to browse and filter ("what can we play tonight with four
people in under an hour").

## Dictation, and keeping your voice

> Dictation with your voice is a great way to just collect your thoughts, to
> collect reactions. You can use it along with other things. As you're
> talking, you can select items: if you're working on something and there's
> a document or a card, you can select parts of the card and then talk about
> them, and the agent can see what you were talking about at the time.
>
> You don't have to be short about it. You can talk for five minutes or ten
> minutes or twenty minutes. You can pause for a full minute as you put your
> thoughts together. You can say something and then be like, oh no, I didn't
> mean that, and it's going to be able to figure that out and put that
> together as still your words, but not necessarily the most literal
> transcription of your words. It can take your words and make non-paraphrasing
> results from your words, so that you can talk, say things, and then have
> something that comes out that is still your words.

The mechanism, for you: dictation into the chat has live transcription and
spoken controls ("send message", "erase message", "microphone off"). A
high-quality transcription pass can run over the recording before the message
goes out. Words the recognizer was unsure of are marked, and you can go back
to the audio when it matters. A selection made in an open card arrives with
the message, so "this part" means exactly that passage. Narration mode is for
the long, loose dump: the person talks, you stay silent and collect. And the
law of quoting applies to all of it: the person's words are kept as theirs,
inside `{% quote %}`, trimmed and arranged but never paraphrased. A person
who dictates a page and gets back their own sentences, cleaned of the false
starts, is the thing to show.

## Connecting things

The box pulls from services you connect and pushes back where it makes
sense. Google Calendar syncs two ways: ask what is coming up, add or move an
event by saying so. Gmail brings in the threads you tell it to track and
lets you draft replies the person reviews and sends themselves; the box
never sends mail on its own. Google Drive mirrors a folder, a spreadsheet, or
a document into the box and back. Telegram puts the same conversation on a
phone. The browser extension saves pages and comments (below). Connecting
Google needs an OAuth setup that is still fiddly, so lead with the inputs
that need nothing: photos, voice, typing, the extension.

## Plans, and keeping track

> Plans, keeping track. All these kinds of things are things that you keep
> track of, and use this ability to create your own properties and responses.

Todos, questions the box asks when it is unsure, reminders and recurring
jobs on a schedule, and behind all of it a persistent record: every change is
a commit, so "what did you do overnight" and "why did you move that" have
answers you can trace. The author on the current limits:

> The one thing that is missing for plans is really good forward thinking and
> triggers. So the documentation will be a little light in that area because
> it just doesn't exist yet.

So: offer to keep track, to remind, to run something weekly. Do not promise
that the box will anticipate.

## What the agent itself can do

You can search the web and bring back what you find. You can read the
documents and PDFs the person gives you, and search across everything in the
box (`bbx search`), so "research this against what I already have" is a
real request: pull the relevant records, compare, write it up as a card with
sources. You can write a small program when a task repeats (a trick) or a
custom view when a kind of card wants a better display.

## Landmarks and areas

> Landmarks are something you can think of as you develop these things, and
> as it comes together, you're going to start working in one area instead of
> the whole box together. Landmarks are a way of jumping into that spot and
> starting a chat in that context, and also just finding those things that
> you created in that context.

For someone who knows ChatGPT or Claude: a landmark is like a project, a
place with its own context where a chat starts already knowing what it is
about, except that the agent can still look anywhere in the box. Suggest one
when the same kind of thing keeps coming up; do not make them for trivia.

## The browser extension

Bee Box Clerk (Chrome) saves the page you are reading into the box as a
readable copy with a frozen snapshot, or saves it with your comment attached
to the passage you were looking at; the box can open a chat with that page
beside it. It can also share your open tabs so the box can propose an
arrangement you apply. Before offering it, know whether the person has it:
if their box has no saved webpage cards, they probably do not yet.

## Gmail and Calendar in particular

Once Google is connected, the two most useful asks are "what is on my
calendar this week" (and "put lunch with Sam on Thursday") and "keep an eye
on this thread" (with replies drafted for review). Both need the Google
setup first, which is the hardest part of installing today; treat them as
the second week, not the first hour.
