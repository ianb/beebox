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

Directions to weigh (design, not settled): a first-run dashboard state
("your box is empty — here are three things to try"), chat zero-state
prompts, `cb init` seeding a small starter card or two, hiding the
schedule internals until there's operator-relevant content, and whether
the dashboard is even the right landing surface for a fresh box vs chat.
Related: [demo-readiness](../docs-and-chores/2026-05-22-demo-readiness.md)
(the show-a-demo angle on the same emptiness),
[today-view](2026-05-11-today-view.md). The dashboard's ops-heaviness for
*established* boxes is a real but separate tension — the boxholder's
"the dashboard is crap" covers both.
