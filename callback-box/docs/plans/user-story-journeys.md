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

## The five journeys

Each is a goal from someone's life with a reason attached, because the reason decides what a good
outcome looks like.

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

Dropped from the earlier draft, per your read: buying duplicate books, tracking recommendations,
saving things read online, "what's on my plate this week" and its siblings, "what even is this",
"what's already in here". The first-contact ones are worth revisiting once we know how these fare.

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
- **When anything was injected**, on the same timeline as the person's actions — so "mail arrived
  at 14:02, they noticed at 14:31, via the dashboard" is answerable, and so is "they never did".

**Clock time is judged afterwards, not by the walker.** Turn count is the wrong measure — a person
does not experience turns. What matters is whether a goal took four minutes or forty, and whether
any single step sat waiting long enough that a real person would have left. That analysis reads
timestamps; it does not ask the agent how long anything felt.

## Materials

**Provisioned ahead of time, not improvised.** The earlier draft had the simulated person hunting
for stock images mid-walk, which wastes steps and makes runs irreproducible. Instead each journey
ships with an asset set and a plain description of what each asset is, and the person is told what
they have.

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

Two things to decide, both in the open questions: how much of `test1`'s existing content is
*helpful* realism versus noise that answers the journey's question before it is asked; and whether
journey E's mail fixtures are staged into the box directly or delivered through a real connector
run.

## Open questions

- **The five journeys** — right set? B and C are rewritten from your notes; check I took the point.
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
