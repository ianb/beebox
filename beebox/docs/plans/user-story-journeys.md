---
title: "User-story journeys — a simulated person trying to get something done"
status: draft
workstream: user-stories
issues: []
---

# User-story journeys

A proposal, for feedback on the shape before anything is built.

## What the capability catalog cannot see

[The 2026-08-21 catalog](../../user-stories/catalog/2026-08-21.md) is an inventory: 649 statements
of the form "the product can do X". It has no notion of a person with a motive. Every entry begins
from the product's side and asks whether the code backs it. Nothing in it starts from someone who
wants to stop losing track of what they lent out and has never heard the word "card".

## The journeys

Each is a goal from someone's life with a reason attached, because the reason decides what a good
outcome looks like. A to E are people who already know what they want; F is the person working out
whether they want anything.

### A · "I want to remember who has my stuff"

Books, tools, a camping stove — things lent to people, and no memory of who has what. Wants to be
able to ask, and to know what to chase.

### B · "I never know what I've got"

An open-ended personal inventory — craft supplies, tools, the contents of a workshop drawer. Not a
tidy enumerable list: things with no obvious categories, bought over years, some of which the
person cannot name precisely. Wants to stop rebuying and to find things.

### C · "I want to reconnect with people I've lost touch with"

Friends who have drifted. Who they are, when we last spoke, what was going on with them, what to
pick up on. Wants to actually get back in contact rather than feel bad about it.

### D · "I'm teaching myself chemistry and my notes are a mess"

Working through a textbook alone, an hour most evenings, notes scattered across a notebook and a
phone. Wants one place that holds what they are learning and shows what is covered and what is
next. *(The box models this richly — `Course`, `LessonPlan`, `Progress`, `ConceptMap` — so the
question is whether any of it is reachable by someone who does not know it exists.)*

### E · "I can't keep up with the school schedule"

Term dates, a newsletter, a class trip needing a form back, a conference sign-up with a booking
deadline before the event — arriving across email and calendar. Wants to stop missing things.

Structurally different from the others: the mail **arrives while the person is not looking**. See
[Things that happen while you are away](#things-that-happen-while-you-are-away).

### F · "What would I even use this for?"

Someone set it up for you and said it would help you keep track of things. Before committing any of
your life to it, work out what it is actually for — and come back with a list of things in *your*
life you would genuinely use it for, and the things you assumed it would do that it apparently
does not.

This replaces the "what even is this" journey, which was too open-ended to run: told only to
"work out what this is and do one useful thing", a person wanders and the result is a travelogue.
A mission fixes that without giving anything away. The person still arrives knowing one sentence
and no vocabulary; they just have a reason to look, and something to produce.

**The deliverable is the interesting part.** A newcomer's list of "things I'd use this for", written
after an hour inside the product and before reading a word of documentation, is the most direct
evidence available of what this product *appears* to be. Gate 3 is the problem of writing an honest
"what is this / should you use it"; the gap between that list and the real answer is precisely what
the README has to close. The things they *wrongly* expected are worth as much as the things they
got right.

**No assets.** This journey is about forming a view, not processing material, and anything handed
over becomes the task instead (see [Materials](#materials)).

Dropped from the earlier draft, per your read: buying duplicate books, tracking recommendations,
saving things read online, and "what's on my plate this week" and its siblings. "What's already in
here" stays dropped as too unbounded — F covers the useful half of it.

## Nowhere to put it yet

The most likely outcome of any of these journeys is not that the box does the wrong thing. It is
that **data turns up and the box has no shape to put it in** — no schema, no instructions, no
existing structure the new thing belongs to.

That is how a box normally starts. Journey B has photos of a drawer and no inventory type. Journey
E has school mail and nothing that models a term, a deadline, or a form that needs returning.
Neither is an edge case we stumbled into; it is the ordinary condition of a box that has not been
taught anything yet, and every real box passes through it.

So it is a subject of the journey, not a failure of it. What we are watching:

- Does the box **notice** it has no shape for this, or does it file the thing somewhere generic and
  consider the matter closed?
- Does it **ask**? A question back to the person is a strong answer — it is how a box gets taught —
  and whether one ever appears is worth knowing.
- Does it **propose a shape**, and is the proposal any good?
- Does the person find out what happened to their stuff, or does it become sediment?

A box that quietly absorbs everything into an undifferentiated pile is a plausible product, and so
is one that asks a lot of questions early. Which one this is, is a thing the journeys can answer and
the capability catalog structurally cannot.

## Things that happen while you are away

There is no live mail account, so the school mail is injected — but *when* it lands is a design
choice, and the obvious choice is wrong.

If the mail is sitting in the box when the person first opens it, the journey becomes "find the
school information", which is a search test. The real situation is that mail arrives overnight,
while nobody is looking, and the question is **whether you ever find out**. That is a test of what
the box surfaces on its own, and it cannot be run any other way.

So journey E runs in **two sittings**:

1. The person arrives with their goal and does whatever they do — looks around, asks the assistant,
   perhaps sets something up.
2. They leave. The fixtures are injected, and the box is allowed to react exactly as it would to a
   real sync — intake, triage, whatever it does unprompted. Nothing announces this.
3. They come back later with no prompt about what happened. What they encounter, and how long it
   takes them to learn anything arrived, is the finding.

**The injection is not just files on disk.** Dropping cards into the inbox and stopping would test
nothing — the box would never have reacted. The staging has to run whatever the box runs on new
mail, so the second sitting meets a box that has genuinely processed the arrival.

**The person may also trigger it.** If they go looking for a way to check for new mail and find
one, that is a legitimate path and worth recording — it tells us the manual route exists and is
discoverable. But the default is unattended, because that is the normal case.

This generalises past journey E. Anything the box does on its own — a schedule firing, a scheduled
review, a question it decides to ask — can be staged the same way, and probably should be. A box
that only ever acts when watched is a different product from the one described.

## The simulated user

**What they know.** That this is an AI-powered app for organising their life. That is the whole
briefing — roughly what a friend's description gives you, and enough to make their behaviour
plausible: they will expect to be able to talk to it, and to look around.

**What they do not know.** Any product vocabulary — card, landmark, inbox, capture, schedule,
connector. Any route. Any file layout.

**They push through.** Confusion gets noted and then worked around, not surrendered to. A capable
model in character is more persistent and more literate than a typical newcomer, and that is fine:
we would rather it see a flaw, record it, and carry on to the next thing than stop cold. Giving up
is a last resort, not an outcome we are fishing for.

**They have no sense of time.** They will not report impatience, and we should not ask them to —
a simulated person's "this felt slow" is worthless. Wall-clock is measured from the outside
instead; see [Instrumentation](#instrumentation).

**How they find things.** Any way a person would: looking around, or **asking the assistant
directly**. Asking is first-class, not cheating. If the fastest route to every goal turns out to be
"ask the agent", that is a finding about the product.

## Note-taking, with a shape

Loose prose invites a travelogue. Structure prompts the useful material without forcing a form —
the answers can be ad hoc, and skipping one is fine:

- **What am I trying to do next?** The immediate sub-goal, in my own words.
- **What do I see?** What is actually on the screen that bears on it.
- **Is anything confusing?** Words I do not understand, choices I cannot tell apart, things that
  seem to have happened without my asking.
- **What will I try next, and why?** The prediction is the valuable part — it exposes what the
  interface led me to expect.
- **Did that do what I thought?**

Plus, whenever it applies: **what I wanted and could not find**, and **material I wish I had**.

Notes stay in character and stay loose. **A separate pass turns them into issues afterwards** —
stopping to write a bug report is out of character and would distort the walk.

## Instrumentation

The notes are one person's account. They will not describe what the backend did, and a person who
says "I saved it" may not have. Everything needed to reconstruct the run is captured outside them:

- **A timestamp on every action and every note**, so the narrative can be laid against wall-clock.
- **Screenshots** at each step, so a claim about what was on screen can be checked.
- **The page and URL** at each step, giving the actual path taken.
- **Network activity** — which endpoints were hit, what failed — from the browser side.
- **The box's own state**: a git snapshot before and after, so what landed on disk is recoverable
  independently of anyone's report.
- **System events on the same timeline as the person's actions** — `email arrived`,
  `email processed`, `schedule fired`, `question raised` — even though nobody was present for them.
  Without those entries the log cannot explain itself: a gap is just a gap. With them,
  "mail arrived 02:14, processed 02:14, noticed 09:31 via the dashboard" is answerable, and so is
  "never noticed".

**Not all elapsed time is slowness.** A gap that spans a deliberate absence — the person left, mail
arrived overnight, they came back — is the passage of time, not the product being slow. A gap
*inside* a sitting, where someone sat waiting on the box to answer, is. Marking each sitting's start
and end is enough for an analyser to tell them apart, given the system events above; nothing needs
to be decided while the run is happening.

**Clock time is judged afterwards, not by the walker.** Turn count is the wrong measure — a person
does not experience turns. What matters is whether a goal took four minutes or forty, and whether
any single step sat waiting long enough that a real person would have left. That analysis reads
timestamps; it does not ask the agent how long anything felt.

## Materials

**Provisioned ahead of time, not improvised.** The earlier draft had the simulated person hunting
for stock images mid-walk, which wastes steps and makes runs irreproducible. Instead each journey
ships with an asset set and a plain description of what each asset is, and the person is told what
they have.

**Only what this run needs.** Assets are scoped per journey and nothing else is mentioned. A person
who is handed two photos will treat the photos as the job — the B pilot did exactly that, and spent
its evening processing images rather than pursuing the thing it wanted. A journey about getting to
know the box gets no assets at all; journeys A and C need none either, because they start from what
the person knows rather than material they hold. An asset that is not needed is not neutral, it is
a distraction with a claim on the person's attention.

**Assets are an input, not the task.** The photos are what this person happened to have to hand
tonight; the goal is the thing they want to be true in a month. The prompt should read that way
round — the situation and the continuing purpose first, the material mentioned late and lightly —
or the walk becomes an import job. This is an ongoing relationship with a box, not a one-off
conversion: they will come back, add more, and ask questions over time, and a journey that ends
when the last photo is processed has tested the wrong thing.

**Voice is not simulated.** Recording is interactive in ways a simulated person cannot drive — the
keyword system especially — so where a journey would involve speech we inject the transcript
directly and note that the real path was not exercised. Transcription accuracy is out of scope for
now; it is either deterministic or absent.

### What I need from you

Real material beats stock, and you offered. Per journey:

| Journey | Asset | Why real matters |
|---|---|---|
| B · inventory | 3–5 photos of a genuinely messy drawer, shelf, or workbench — craft supplies, tools, oddments | Stock "workshop" photos are tidy and legible. The whole difficulty is items that are partly hidden, unlabelled, or hard to name. |
| D · chemistry | 2 photos of real handwritten study notes (any subject — content can be nonsense) | Tests whether handwriting survives the intake path at all; typed text would skip the interesting part. |
| E · school | 3–4 emails: a newsletter, an event invite, something needing a reply by a date. Scrubbed or invented | Needs to look like real mail — threading, quoting, footers — which invented fixtures rarely do. |

A and C need no assets: they start from what the person knows rather than material they hold.

## Box staging

**A disposable clone per journey, based on `test1`**, plus journey-specific staging. `test1` is
realistic in a way an empty box is not — an app with content in it behaves differently from one
without.

**But not its conversations.** The B pilot opened mid-sentence inside a stranger's chemistry
course, because `chat-session-id.json` is a resume pointer: a fresh visit reopens whatever session
was last active. The person's first ten seconds were spent reading someone else's chat, containing
a garbled message and an attachment they could not open. Nothing about that tested this product;
it tested our fixture.

So a journey box takes `test1`'s *content* and none of its *chat state*:

| Cleared | Why |
|---|---|
| `.beebox/chat-session-id.json` | the resume pointer — leave it and the person lands in an old conversation |
| `.beebox/chat-session-history.json` | the session list behind the chat picker |
| `.beebox/active-chats/*.lock` | stale locks from another run |

The Claude Code transcripts themselves live outside the box, under `~/.claude/projects/`, keyed by
the box's path. **Giving each journey box a fresh path isolates them by construction** — no cleanup
needed, and two journeys can never read each other's conversations. That is the mechanism to lean
on; clearing the in-box pointers is the belt to its braces.

What remains open is how much of `test1`'s *content* each journey should see — its existing courses
and people are realistic, but a chemistry journey landing in a box that already has a chemistry
course is a different test from one that does not.

## Open questions

- **The five journeys** — right set? B and C are rewritten from your notes; check I took the point.
- **Whether a journey should span more than one sitting by default.** E needs two because of the
  arrival mechanic. But "I will come back and add the other drawers" is the real shape of B as
  well, and a single sitting cannot show whether the second visit is any good — which is where an
  organiser either earns its keep or becomes sediment.
- **How much `test1` content should each journey see?** Its existing courses and people are
  realistic, but a chemistry journey landing in a box that already has a chemistry course is a
  different test from one that does not.
- **Journey E's fixtures** are written and scrubbed, waiting on your review before they go in the
  repo. They live in the workstream store for now. What still needs deciding is what the staging
  should *trigger* — the full intake and triage path, or a narrower slice.
- **How much the person knows** — one sentence, as written. Less is implausible; more gives away
  the map.
- **Is the note structure the right set of prompts?** Those five are a guess at what elicits the
  interesting material.

## Cost

Two or three journeys as a pilot: a handful of agents, well under an hour — interactive walking is
slower per agent than the catalog's readers, but there are very few of them. All five plus a review
pass is perhaps 8–10 agents.
