---
title: "First-run experience: the empty box explains nothing"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — first-run UX audit for the soft launch
---

Audited 2026-07-20 by code-reading. What a brand-new user sees after
creating their account on a fresh `cb init` box:

- They land on the **Dashboard**, which on an empty box is an ops panel:
  the Attention and Health sections vanish entirely (render `null` —
  `AttentionCards.tsx:22-24`, `HealthWarnings.tsx:15-19`), Recent Activity
  says "No recent activity", and the one populated section is the
  **schedule table full of internal housekeeping** the user never
  configured — cron strings, `[Xs/Ys]` budget jargon, Run buttons for
  `refresh-maps`/`gc-procedure-runs`/`process-retrospective`
  (`ScheduleOverview.tsx`). No welcome, no "here's what to do next",
  anywhere.
- **Chat has no zero-state**: a new chat is an empty scroll area and a
  composer placeholder. Nothing suggests what to say to a system whose
  whole pitch is "feed it things and teach it."
- **`cb init` seeds zero user-recognizable content** — everything
  scaffolded is agent-facing config (guide cards, the personality card,
  schedules, a placeholder briefing). No sample cards, no "try asking me
  to…" seed.
- The individual list surfaces mostly have fine one-line empty states
  (Landmarks' even names the mechanism); the Dashboard is the outlier.

This is the "boxholder's first hour" gap: install docs get someone to a
running box (verified, good), and then the product goes silent. For the
soft launch ([posture](../decisions/2026-07-20-soft-launch-posture.md))
this is likely the single biggest make-or-break surface after install.

## Design direction: a menu of flows that just work (boxholder, 2026-07-20/21)

The bar: "people need exciting success early." The settled shape is a
**firm menu of a few complete flows**, each with a real payoff, offered
at first run — NOT an open "feed me anything" (too much openness is
burdensome; the blank page is the user's problem again) and NOT
demonstrations of machinery. The candidate menu archetypes:

1. **Interactive/concrete — the recipe walk-along.** Give it a recipe
   URL or a photo of a recipe; the box walks you through cooking it,
   steps and timers included. The chat-schedule machinery was
   originally built for exactly this, and a recipe renderer already
   exists (`src/frontend/src/renderers/`). Making this flow "just
   work" end-to-end is the flagship candidate.
2. **Data-oriented — an inventory.** Photograph a pantry/bookshelf/
   whatever; the box builds structured cards you can query and keep
   current.
3. **Creative — make me a thing.** "Create me a little course on X" /
   "create me a visualization of Y" — the box produces an artifact
   that's yours in the first session.
4. **Self-knowledge** — flagged by the boxholder as "really
   interesting" as a menu item; shape TBD (relates to the exploration
   queue's user-model/behavioral-profile cluster).

Each menu item is product work, not prompt-and-guide work (boxholder,
2026-07-21): the flow must genuinely work end-to-end for a stranger or
it's a broken promise in the first ten minutes. Pick few, make them
reliable, and **dogfood each one** — "stuff always comes up"; a flow
nobody has actually cooked/inventoried/built-a-course through doesn't
count as done.

Mechanism ideas (boxholder, 2026-07-21):

- **An onboarding directory + onboarding landmark.** New users get
  pushed into it at the start; it holds the how-to-interact/how-to-use
  instructions and presumably the menu itself. This makes onboarding
  box *content* (cards + a landmark) rather than app chrome — it uses
  the landmark navigation system that already exists, is inspectable/
  editable like everything else, and can retire itself when the user
  outgrows it.
- **UI pointing, borrowed from Memory Atlas.** The boxholder's prior
  project has "a whole system" for the assistant pointing at UI
  elements; onboarding-scoped instructions could let the agent point
  at parts of the interface while explaining them. NOTE: the pointing
  system is NOT described in
  `research/memory-atlas-architecture-review.md` (checked 2026-07-21)
  — the knowledge is the boxholder's / the Memory Atlas source; ask
  him or read that codebase before designing this.
- **Teaching the system's own concepts is onboarding content.** "What
  is a card" and the other basics belong in the onboarding landmark —
  the agent understands the system but has to *explain it to the
  user*, which is its own interesting task. For this audience
  (developers first) the conceptual material is genuinely useful, not
  filler.
- **A strongly conversational onboarding persona — wide knowledge,
  deep introspection.** The boxholder wants (in general, and here
  specifically) an onboarding agent that can answer essentially any
  question about the system by *introspecting* — reading its own
  config, docs, schemas, state — rather than reciting a script. The
  onboarding landmark's instructions set this register.
- **Role-marked users get different instructions.** Mark the admin/
  owner user, and the agent instructs them differently from an invited
  member (auth already distinguishes owner from member accounts —
  `cb auth create-user` vs `add-user`; the agent-facing instruction
  layer currently doesn't know the difference). An invited member's
  onboarding is a different, smaller menu than the operator's.
- **The menu needs a layout system.** Beyond the per-flow product
  work, something has to present and sequence the menu items — closer
  to documentation/content structure than engineering; plausibly just
  cards in the onboarding directory.

Considered and rejected/demoted (boxholder reactions, recorded so they
aren't re-proposed):

- **Box talks first** — incidental plumbing; an induced initial
  response is easy and fine, but it's not the feature.
- **Correct-it-watch-the-rule-stick** — not easy to do and doesn't
  work that well as a demo.
- **Open-ended voice-memo ramble** — too much openness, burdensome.
- **Lived-in fictional demo box** — disliked; the surviving kernel is
  **installable packs** ("install something that launches a bunch of
  stuff"), which connects to
  [canonical-wisdom-corpus](../exploration/2026-05-11-canonical-wisdom-corpus.md).
- **Prewarming / their-agent-introduces-them** — rejected as creepy
  (including the boxholder prewarming boxes for invitees himself).
- **Import existing data** — important but email is heavy; calendar is
  the easy one. Not a first-menu item by itself.

Supporting changes from the audit: chat zero-state presenting the menu,
a first-run dashboard state, hiding schedule internals until relevant
([schedules-off-by-default](2026-07-20-schedules-off-by-default.md)
does most of this), and whether a fresh box should land on the menu
chat rather than the dashboard. Related:
[demo-readiness](../docs-and-chores/2026-05-22-demo-readiness.md),
[today-view](2026-05-11-today-view.md). The dashboard's ops-heaviness
for *established* boxes is a real but separate tension — the
boxholder's "the dashboard is crap" covers both.
