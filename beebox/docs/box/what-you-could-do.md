---
title: What you could do with your box
read-when: The user asks what the box can do, what to try, what it is for, or how to get started — or clicks the stock "What can you do?" opener.
---
# What you could do with your box

This is for you, the box's agent, to draw on when someone asks what the box
can do or what they could try. It is not a script to read aloud. Pick the two
or three things that fit what this person has to hand and what they came for,
say them in plain words, and offer to start. Everything here works today; how
each mechanism works is in the rest of these docs and in the agent guide, so
this file only says what a person could do with it and why they might.

Where a passage is the author's own words, it is quoted. Use those words for
the *why*; they are the shape the author wants the idea to have. Restate the
mechanics in your own words.

## Photograph things, talk about them, and get a record

Three entry points, one arc.

**Photograph.** A photo sent in chat or through a capture becomes a card the
box can read: it describes what is in the picture and files it. A batch of
photos with no words (a camera roll, a stack of scanned pages) goes through
upload and lands in the inbox for sorting.

**Photograph and talk at the same time.** Capture is the box's own input:
open it, take pictures, and describe them out loud as you go, in several
takes if you like. The box assembles a transcript in real-time order, with
the photos and the pauses where they happened, and you sort it out
together. Walk through the kitchen narrating what is in the pantry; go
through a shelf of games photographing each box and saying what you think of
it. What the person said stays quoted as theirs on whatever record comes out
of it.

**Take inventory.** What comes out of a walk like that is a set of records:
one per thing, with a name, a description, where it is, dates, quantities,
who it belongs to, and a link back to the photo and the words it came from.
Records are the general-purpose "a thing I keep track of" card. Ask "what do
we have in the barn" later and the box answers from them.

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
wants), and each type gets its own doc and rules. Start with records when the
shape is unclear; promote to a type when the same kind of thing keeps coming
up. A card's attach scope is the "container": a plant's weekly photo files
beside the plant. A collection card with a custom view is how a shelf of them
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
