---
title: "Implementation vocabulary leaks into first-contact UI and agent replies"
workstream: vocab-sweep
resolution: implemented
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activities 1+2)
labels: [soft-launch, field-test-findings, ui-sensibility]
priority: important
---

> **Closed 2026-09-02 (vocab-sweep).** All remaining items landed on this
> branch (see `beebox/docs/implemented-plans/vocab-glossary-sweep.md`, Track
> C): box-not-found copy, session→chat labels, error-badge gate, view tabs,
> transcription glosses, nav chrome, and the name collisions via the
> glossary's new user-facing register (`beebox/docs/glossary.md`). UI copy
> changes verified by tests and Track O review, not exercised in a browser.

> **Further progress 2026-08-09 (later):** the "worst single item" —
> filename-as-heading — is fixed: card page and chat headers now headline the
> card's frontmatter `title:` (falling back to a humanized name, underscores
> as spaces, never the raw `Name.type.card`), with the path demoted to a
> small subtitle and the redundant "Type:" line dropped (`FileView.tsx`).
> Remaining below: the view tabs ("Recipe / Card / Source"), the box-not-found
> error page, and the nav-chrome labels.
>
> **Partly resolved 2026-08-09** in `73f4e8e0`: the *agent-reply* half (jargon
> in chat — "drop a landmark", "person card", "boxholder" in the third person)
> is addressed by a new agent-guide section, "Speak the User's Language",
> verified by the `speak-users-language` knowledge audit (pass,
> knows_directly). The `agent-behavior` label is dropped; what remains below
> is the UI-surface sweep (filename-as-heading, view tabs, error pages, nav
> chrome).

A first-week user persona collected, verbatim, the words the product showed it
that it could not understand. The list is a map of implementation vocabulary
reaching user-facing surfaces:

- **`store/recipes/Lemon_Chicken_With_Olives.recipe.card`** as the *page
  heading* on two of the three card views (plus "Type: recipe" under it). The
  card has a display title; the filename should not be the headline.
- **"Recipe / Card / Source"** view tabs — "what's the difference between my
  recipe and 'the card'? Isn't the recipe the card?"
- **"No box matches `box` on this server"** — "box" used as concept and name
  in one sentence, plus "server," on an error page with no recovery action.
- Agent replies: **"drop a landmark in `store/recipes/`"**, **"person card"**,
  **"the view can double it"**, **"[→ original recipe.txt: verbatim, from the
  recipe file the boxholder saved]"** — "boxholder" as a third-person label
  for the person being addressed.
- Chrome labels: **"Place: Chat"**, **"Session menu"**, the chip flipping to
  **"box ▸ Card"**.
- **"Open Lemon_Chicken_With_Olives attachments"** — unexplained "attachments"
  on a thing the user thinks of as a recipe.

No single fix; this is a sweep-shaped tension: each surface (card view header,
view tabs, error pages, nav chrome) needs a user-words pass, and the box
agent's guidance should tell it to explain-or-avoid box jargon when talking to
the user (the agent-guide / box CLAUDE.md owns that). The worst single item is
the filename-as-heading on card views.

Related: [first-run-experience](../../features/2026-07-20-first-run-experience.md) (the
surrounding "explains nothing" tension);
[day-to-day-usage-docs](../../docs-and-chores/2026-07-20-day-to-day-usage-docs.md).

## Second collection, 2026-08-23 (journey B, an independent first-time walk)

A second simulated first-time user, given only "a friend set this up for you"
and a drawer to inventory, collected the same class of words without knowing
about this issue. Two things it found are new.

**The names collide with each other, not just with the user's vocabulary.**
The earlier list is words a user does not know. This is worse: several words
name more than one thing, so learning one does not help.

- **Box** is the app's name for itself ("your box assistant"), the name of the
  user's own box in the menu ("Box: journey-b"), *and* a place inside the app
  called just "Box". Verbatim: "I can't tell them apart."
- **Session** and **chat** name the same object in the same menu.
- **"Agent is working…"** and thinking are two names for one state.
- **Place** appears as chrome ("Place: Chat") with no referent the user can
  point at.
- The running tally at the end: "box, landmark, session, agent, reactor, chat"
  — six words, and "I couldn't draw the diagram."

**"Inventory" is taken, and it means disk usage.** The dashboard uses it for
the box's own storage — file types, linked versus unlinked content. The user
had come to inventory a drawer. Verbatim: "The word *inventory* is taken, and
it means *the app's own disk usage*. That is the exact word for what I came
here to do." A word collision with the user's actual job, in the one place
they were most likely to look.

Also collected, smaller:

- **"Open debug log (2 errors)"** with a red badge, on the first screen, to a
  user who has done nothing. Developer vocabulary and a developer surface at
  first contact; the badge is ungated in `AppNav.tsx` (`ErrorBadge`).
- The **three unlabelled top-right icons** do carry `title`/`aria-label`, so
  this is not an a11y gap — but a first-time user does not hover, and "I'm not
  going to click blind yet" is where they stopped.
- Settings names **Deepgram** and **Whisper** with no gloss: "I don't know what
  Deepgram is, I half-know what Whisper is, and I don't know what choosing
  between them would do to me."
- **"Claude Code is not logged in"** — a product name the user has never seen,
  in a message about *their* login state, while they are logged in. "So the app
  and I disagree about whether I'm logged in, using the same word."

Full notes: `beebox/user-stories/work/journeys/B-inventory-2026-08-23*/notes.md`.


> 2026-09-02 (vocab-sweep, later): the sweep is implemented on this branch —
> vocabulary decided with the boxholder and recorded as a user-facing register
> in `beebox/docs/glossary.md` (chat/Home/Storage/Thinking…, box = the user's
> box, no "agent"/"box assistant"); all surfaces below reworded, the error
> badge gated behind ever-having-opened the debug log, view tabs relabeled by
> card type, transcription rows glossed live-vs-final. Cross-model reviewed.
> Plan: `beebox/docs/implemented-plans/vocab-glossary-sweep.md`.

> 2026-09-02 survey (bbx-pick-issues): re-verified still true. `app-shell.tsx` still says "No box matches …", `AppNav.tsx` debug-log badge still ungated, `SessionChip`/`PlacePill` still say "Session menu"/"Place:", `VoiceChip-panels.tsx` still labels raw Deepgram/Whisper. Filename-as-heading and agent-reply jargon halves are fixed. Grouped with 2026-08-08-markdown-not-rendering-in-agent-output (agent imitates `[→ …]` compiled-doc markup) and 2026-08-24-agent-records-counts-in-prose-though-measures-exists as one internals-leak vocabulary sweep.
