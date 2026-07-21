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

Each menu item is product work: the flow must genuinely work
end-to-end for a stranger or it's a broken promise in the first ten
minutes. Pick few, make them reliable.

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
