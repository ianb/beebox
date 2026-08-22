---
title: "User-story journeys — a simulated person trying to get something done"
status: draft
workstream: user-stories
issues: []
---

# User-story journeys

A proposal, for feedback on the shape before anything is built. Supersedes an earlier draft that
framed these as failure-hunting; the correction is recorded under [What this is not](#what-this-is-not).

## What the capability catalog cannot see

[The 2026-08-21 catalog](../../user-stories/catalog/2026-08-21.md) is an inventory: 649 statements
of the form "the product can do X". It is a good reference and a bad answer to "can a person
actually use this for something they wanted".

It has no notion of a person with a motive. Every entry begins from the product's side — a feature
that exists — and asks whether the code backs it. Nothing in it starts from someone who wants to
stop losing track of their books and has never heard the word "card".

## The simulated user

One agent plays a person. Everything else follows from how much that person knows.

**What they know.** That this is an AI-powered app for organising their life. That is the whole
briefing. It is roughly what someone gets from a friend's description, and it is enough to make
their behaviour plausible — they will expect to be able to talk to it, and to look around.

**What they do not know.** Any product vocabulary: card, landmark, inbox, capture, schedule,
connector, procedure. Any route. Any file layout. What the box is built on. They do not know what
the app is *for* beyond that one sentence, and part of what we are watching is how quickly and how
accurately they work it out.

**What they bring.** A goal from their own life, and a reason for it. Not a task phrased in the
product's terms.

**How they are allowed to find things.** Any way a person would:

- looking around the interface
- **asking the assistant directly** — a first-class path, not cheating. A real person handed an
  AI-powered app asks it what it can do. If the fastest route to every goal turns out to be "ask
  the agent", that is a finding about the product, not a flaw in the test.

**What they narrate.** This is the primary output — see [What comes back](#what-comes-back).

## What a journey is

**A goal from the person's life, plus why they want it.** The motive is not decoration: it decides
what a good outcome looks like. "Keep track of my books" so I stop buying duplicates wants
different results from "keep track of my books" so I can lend them out and remember who has what.

The journeys are chosen so the box can plausibly serve them. We are following the happy path — the
question is whether a person can *find* it from where they start, not whether we can break it.
Nothing here is bait. A journey the product genuinely doesn't do (order me dinner) is not on the
list, and the selection therefore encodes what the product is for.

## The rules of the simulation

**Materials are stood in for, and the user is in on it.** The person cannot photograph their own
bookshelf. They can find a stock image of a shelf of books and use that, knowing it is a stand-in.
This is a McGuffin: the simulated user knows the real material would be better and proceeds anyway.
When they *want* material they cannot get, they say so in their notes — "a photo of my actual
shelf would have been the real test here" — which tells us what a real run would need.

**Fresh box per journey**, so "the first time I opened this" is honestly the first time and no
journey inherits another's mess. Journeys that need a populated box get one seeded to a stated
starting state.

**A step budget**, generous but finite, so "gave up" is a real outcome rather than an infinite
grind.

## What comes back

Not a score. **A narrated walk**, in the person's voice, thinking out loud:

- what they were trying to do next, and why they thought that would work
- what they were looking at when they decided — the actual text on screen that informed it
- what they expected to happen versus what did
- where they were confused, and what resolved it
- what they concluded the app is for, as that understanding changes

Plus **notes**: loose observations, including things that looked broken, things they wanted and
couldn't find, and material they wished they had. Notes are deliberately unstructured and
deliberately not issues.

**A separate pass turns notes into issues later.** The person walking is not the person filing —
they are in character, and stopping to write a bug report is out of character and would distort
the walk. A later review reads the narratives, decides what is a defect, and files it.

**A separate check confirms what actually landed** in the box, by reading its files — not by asking
the walker whether it worked. Someone who believes they filed their books and did not is a finding,
and only an outside look can tell the difference.

## Candidate journeys

In the person's words. **This is the list I want your reaction to.**

### Keeping track of things that are mine

1. **"I keep buying books I already own."** Get a handle on which books I have, so I can check
   before buying. *(No book or inventory card type exists — so this is also a test of whether the
   box can be bent to a shape the user brought.)*
2. **"I want to remember who has my stuff."** Things lent out, and to whom.
3. **"I never know what's in the cupboard."** What I have, so I stop rebuying spices.

### Keeping track of people

4. **"I want to be better at keeping up with my family."** What's going on with them, what I last
   talked to them about, when their birthdays are.
5. **"People recommend me things and I forget them."** Restaurants, books, films — who said what.

### Learning something

6. **"I'm teaching myself chemistry and my notes are a mess."** Somewhere to keep what I'm
   learning, that helps me see what I've covered and what's next.
7. **"I read things online I want to actually remember."** Not just bookmarks.

### Running my life

8. **"I want to know what's on my plate this week."**
9. **"I want to be told about things instead of remembering to check."**
10. **"I want to know what I did last month."**
11. **"My inbox buries the things that matter."** *(Needs a real mail account — see open questions.)*

### Getting my bearings

12. **"What even is this?"** Someone set it up for me; work out what it's for and do one useful
    thing with it.
13. **"What's already in here?"** Handed a box with content in it, work out what it holds and
    whether any of it is useful.

### Later — the experienced user

Not for the first round. Once we know how a newcomer fares, the same goals are worth re-running
with a person who has used the box for a month and knows its vocabulary — the gap between the two
is the cost of learning it.

## Two, fully specified

Reacting to these matters more than reacting to the list.

---

### J1 · "I keep buying books I already own"

**Given to the simulated user**

> You are trying out an AI-powered app for organising your life. Someone set it up for you and sent
> you a link and a login; you have not used it before and you do not know how it works.
>
> Here is what is actually bothering you: you have bought the same book twice, three times now. You
> have books at home, books on a shelf at your parents', a few lent to friends. You would like to
> get to the point where, standing in a bookshop, you could check whether you already own something.
>
> You have a photo of one of your shelves (`<path>`) — a stock image standing in for your own, which
> you know is a poor substitute for the real thing. Work towards your goal as far as you can.
>
> Think out loud the whole way. Before each thing you try, say what you are hoping will happen and
> what on the screen made you think so. Afterwards say whether it did. Keep notes as you go about
> anything confusing, anything that seemed broken, and anything you wished you had.

**Starting state** Fresh box, one user, no content.
**A good outcome** Some durable representation of books exists in the box, and the person can get
an answer to "do I own this one?" — by whatever route they found.
**Watching for** Whether they talk to the assistant or go looking first. What they call the thing
they are making. Whether the box offers them a shape or they have to invent one — there is no book
card type, so this is where "AI-powered organiser" either delivers or doesn't. Whether the shelf
photo is usable at all.

---

### J6 · "I'm teaching myself chemistry and my notes are a mess"

**Given to the simulated user**

> You are trying out an AI-powered app for organising your life. You have not used it before and do
> not know how it works.
>
> You are working through a chemistry textbook on your own, an hour or two most evenings. Your notes
> are scattered across a notebook, your phone, and some files. What you want is one place that holds
> what you are learning and helps you see what you have covered and what is coming — you keep losing
> the thread between sessions.
>
> You have the notes from your last two sessions (`<path>`) to start with.
>
> Think out loud the whole way. Before each thing you try, say what you are hoping will happen and
> what on the screen made you think so. Afterwards say whether it did. Keep notes about anything
> confusing, anything that seemed broken, and anything you wished you had.

**Starting state** Fresh box. Two short session notes as a fixture.
**A good outcome** The material is in the box in a form the person judges will help next session,
and they can say what they have covered.
**Watching for** The box models this well — `Course`, `LessonPlan`, `Progress`, `ConceptMap` all
exist — so this is a test of whether that modelling is *reachable* by someone who does not know it
exists. If a newcomer ends up with loose notes while a course structure sat unused, that gap is the
whole finding.

## What this is not

An earlier draft framed these as failure-hunting — success conditions, "believed it had arrived
when it had not", journeys chosen partly because a known gap lived on them. That is a different
instrument, and it produces adversarial prompts that push the simulated person towards suspicion
instead of towards their goal.

These follow the happy path, led by the person. Breakage found along the way is recorded in notes
and triaged later, but finding it is a by-product. The question is whether someone who wants
something can get it.

## Open questions

- **The journeys.** Which are real, which are missing, which are not worth running.
- **How much the person knows.** Currently one sentence — "an AI-powered app for organising your
  life". Less makes the simulation implausible; more starts giving away the map.
- **Journey 11 needs a real mail account.** Worth a seeded fixture instead, or drop it from the
  first round?
- **How long is a walk?** A step budget shapes what gets attempted. Forty actions is a coffee break;
  two hundred is a determined afternoon, which few real people spend on a new app.
- **Who plays the person.** A capable model in character will be more persistent and more literate
  than a typical newcomer, which biases every result optimistic. Worth naming as a known limit.

## Cost

A pilot of two or three journeys is a handful of agents and well under an hour — the walk is
interactive, so it is slower per agent than the catalog's readers but there are very few of them.
The full list would be perhaps 15–20 walkers plus a review pass.
