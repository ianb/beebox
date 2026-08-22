---
title: "User-story journeys — testing whether someone can actually get something done"
status: draft
workstream: user-stories
issues: []
---

# User-story journeys

A proposal, for feedback on the *shape* before anything is built.

## What the capability catalog cannot see

[The 2026-08-21 catalog](../../user-stories/catalog/2026-08-21.md) is an inventory: 649 statements
of the form "the product can do X", each checked against the code. It is a good reference and a bad
answer to "can someone actually use this".

It is structurally blind to the seams. Every step of a task can pass its own check while the task
is impossible, and this run already produced the example: capture ✅, transcription ✅, inbox filing
✅ — all independently verified — while one of the real gaps found was that *capture-session cards
never record the transcription-failed flag their schema documents*. So "I recorded audio while
transcription was down" silently loses information, with every constituent capability green.

Seven of the twenty-one readers were assigned end-to-end threads, so the intent was there. But the
output contract was one-capability-per-record, so those readers decomposed their threads back into
atoms — 244 of the surviving 667 records came from them, and they read like "Change my own
password". The journey was a way of *reading the code*, and never survived into the artifact.

## What a journey is instead

One journey = **one thing a person wants to end up with**, plus whether they can get there.

Not "the app has an audio recorder". Rather: *"I just said something into my phone that I don't
want to lose. Can I end up with something I'll actually find again next month?"* — and then the
honest account of what it took.

The unit of truth changes. A capability story is true if the code implements it. A journey is true
only if someone **arrived**, and the interesting content is everything that happened on the way.

## The method: navigability is the measurement

The point is not to confirm the steps work. It is to find out whether a person who has not read the
source can **discover the path at all**. So the agent walking the journey is deliberately kept
ignorant, and its struggle is the data.

### What the walking agent is given

Only this: the box URL, a credential, and the goal stated the way the person would think it —
in their vocabulary, about their situation, with no product terms in it.

> You recorded a two-minute voice memo on your phone about a book you want to read.
> You don't want to lose the thought. Get it into this system in a form you'd be able
> to find in a month.

### What it is forbidden

This is the part that has to be enforced deliberately, because every instinct is to be helpful:

- **No route hints.** Not `/capture`, not "the capture page", not "there's an upload button".
- **No product vocabulary.** Not "card", "landmark", "inbox", "capture session", "schedule",
  "connector". If the person wouldn't say it before using the product, the agent doesn't get it.
- **No source access.** It may not read `callback-box/src`, the schemas, or the route table.
- **No docs**, in the default condition — see the variable below.
- **No catalog.** It may not read the capability catalog, which is a map of exactly what it is
  supposed to be discovering.

A prompt that names the page is not a test of navigability; it is a test of whether a button works,
which the capability catalog already answers.

### The one variable worth running both ways

**Cold** (nothing but the app) versus **informed** (the README, as a real visitor would arrive).
The gap between the two conditions *is* the README's value, measured rather than asserted — which
is directly what gate 3 needs. Worth running at least one journey both ways.

### What gets recorded

The walk, not the verdict:

- every page visited, in order, and what made it look promising
- **dead ends** — what it tried that led nowhere
- **things it looked for that do not exist** ("looked for a New Note button"). This is the single
  most useful output: it is the product's missing affordances, named by someone hunting for them.
- where it backtracked, and what finally revealed the path
- steps taken versus the shortest possible path
- how it ended: **arrived / partly arrived / gave up / believed it had arrived when it had not**

That last outcome is the worst one and the easiest to miss, which is why:

### The walker does not get to score itself

A separate check confirms the outcome **actually happened** — by inspecting the box's own files and
git history, not by asking the agent whether it succeeded. Same discipline as the catalog's
verification: an agent that says "done" is a claim, not evidence. A false success is a finding of
its own, and a serious one.

### Every journey starts from a fresh box

A disposable clone per run, so results are reproducible, "first hour" is honestly first, and no
journey pollutes `test1` with its leftovers. Journeys that need existing content get a box seeded
to a stated starting state.

## Candidate journeys

Grouped by what the person is trying to do. **This is the list I want your reaction to** — which
are real, which are missing, which are not worth testing.

### Arriving

1. **Work out what this is.** Given access and nothing else, form an accurate account of what the
   box is for and do one useful thing with it. *(Gate 7, directly.)*
2. **Find out what is already in here.** Handed a box with existing content, discover what it holds.

### Getting something in

3. **Voice memo → findable note.** The example above.
4. **A photo of a page** — a receipt, a book page, a whiteboard — ends up as something searchable.
5. **A web page worth keeping** ends up saved, with enough context to be worth having later.
6. **A pile of files** off a laptop ends up filed sensibly rather than dumped.

### Working with the agent

7. **Ask the box about my own stuff** and get an answer that is actually grounded in it.
8. **Give a standing instruction** ("always file receipts under…") and confirm it stuck — later.
9. **Correct a mistake the agent made**, so it doesn't repeat it.

### Getting it back out

10. **Find something added weeks ago** that you only half remember.
11. **See what the box did while you were away**, and understand why it did it.
12. **Take everything with you** — get your content out in a form usable elsewhere.

### Making it act on its own

13. **Make something happen every morning.**
14. **Trace one thing the box did** back to what triggered it.
15. **Stop it doing something** you no longer want.

### Connecting the world

16. **Connect email** and have something useful appear.
17. **Connect a calendar** and see it reflected.

### Operating it

18. **Let another person in**, at the access level you intended.
19. **Recover from a mistake** — undo something the box or you did.
20. **Move the box to a real machine** and keep it running.

## Three, fully specified

The format I would use. Reacting to *these* is more useful than reacting to the list.

---

### J1 · Work out what this is

**Situation given to the agent**

> Someone you trust set this up for you and sent you the link and a login. They said it would
> "help you keep track of things" and then got on a plane. Spend up to forty steps finding out what
> this actually is and what it is good for, and then do one thing with it that you would plausibly
> want done. Report what you concluded, what you did, and what confused you.

**Starting state** Fresh box, one user, no content.
**Arrived when** Content exists in the box that the agent deliberately created, AND its account of
what the box is for is accurate (judged against the README by a separate agent).
**Prohibited from the prompt** Every product term; any page name; any suggestion that there is a
chat, a capture surface, or an inbox.
**Watching for** What it opens first. How long before it finds anything it can act on. Whether it
ever discovers the agent-chat at all — a box whose central feature is undiscoverable in forty steps
is the gate-7 finding.
**Run both cold and informed.**

---

### J3 · Voice memo → findable note

**Situation given to the agent**

> You have a two-minute audio file of yourself talking about a book you want to read. Get it into
> this system so that in a month you could find it again by remembering roughly what it was about.
> The file is at `<path>`.

**Starting state** Fresh box. An audio fixture on disk.
**Arrived when** A separate check finds, in the box's files, content derived from that audio that
is retrievable by its subject matter — not merely an uploaded blob sitting somewhere.
**Prohibited from the prompt** "capture", "transcribe", "card", "inbox", any route.
**Watching for** Whether it finds an ingest path at all; whether it can tell that transcription
happened; whether it ends up believing the memo is safely stored when nothing readable was
produced. This is the journey the transcription-failed gap lives on.

---

### J13 · Make something happen every morning

**Situation given to the agent**

> You want this thing to give you a short summary of anything new, every morning, without you
> asking. Set that up. Then confirm it will actually run.

**Starting state** Fresh box.
**Arrived when** A schedule exists, is enabled, and its next run is in the future — checked in the
box's files, not from the agent's report.
**Prohibited from the prompt** "schedule", "cron", "wakeup", "procedure", any route.
**Watching for** Whether "every morning" is expressible at all without knowing the vocabulary;
whether the agent can confirm it is *enabled* (fresh boxes ship with schedules off, so "I created
it" and "it will run" are different claims, and conflating them is a false success).

## What I want from you

- **Are these the right journeys?** Which are real, which are missing, which would you not bother
  testing.
- **Is the goal statement at the right altitude?** J1's is deliberately vague — a person with a
  link and no explanation. J3's names a concrete file. Both are defensible; they test different
  things.
- **How harsh should the no-hints rule be?** As written the agent gets no product vocabulary at
  all. That is the honest test of navigability and it may produce a lot of failures that read as
  "the agent was stupid" rather than "the product is unnavigable". The alternative — one sentence
  of orientation — makes it a usability test rather than a discoverability test.
- **Is a failed journey a bug?** A journey nobody can complete might be a missing feature, a
  navigation problem, or a thing the product deliberately doesn't do. Those want different
  dispositions and I would rather agree the vocabulary before generating 20 of them.

## Cost

The pilot — three journeys, both conditions on J1 — is roughly 15–20 agents and well under an hour.
The full set of 20 would be perhaps 60–80 agents, still far short of the capability run, because
the expensive part there was reading all of `src` and this reads none of it.
