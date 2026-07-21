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

## Design direction: manufacture the wow (brainstorm 2026-07-20)

The boxholder's bar: "people need exciting success early." The system's
real value compounds over days, so the first ten minutes must
demonstrate the loop honestly rather than wait for it. The proposed
arc — every step real machinery on real input, nothing staged:

1. **The box talks first.** First login lands in a chat the box has
   already opened — it introduces itself (the personality card exists;
   default name Egg), and proposes three concrete things to try now.
   Agent-led onboarding via an onboarding guide card is the
   agent-legible-docs pattern applied to first-run, and needs little
   new UI.
2. **Feed it one real thing, watch the commit.** "Ramble a voice memo
   at me / paste a link / drop a photo" → typed cards + one smart
   question back, and the box *shows the commit* ("here's what I wrote
   down, as a diff"). Git-is-history demonstrated, not claimed.
3. **Correct it, watch the rule stick.** The user fixes something; the
   box shows the rule it wrote and the commit recording it. The
   teaching thesis in sixty seconds; the user has personalized their
   box in session one.
4. **The two-minute callback.** "I'll check back on you in two
   minutes" — and it does, while they watch. The eponymous behavior,
   demonstrated in-session instead of after a day. The most
   alive-feeling moment available.

Side doors, weighed separately:

- **Lived-in demo box** — a pre-populated fictional box (the Lund-Vega
  roster from `docs/architecture/`) to explore the six-weeks-in
  end-state before feeding in anything real. Also serves
  [demo-readiness](../docs-and-chores/2026-05-22-demo-readiness.md) and
  gives the [Pages site](2026-07-20-github-pages-site.md) honest
  screenshots.
- **Import what already exists** ("point me at a notes folder /
  bookmarks export / ICS") — their real data in ten minutes; heavier
  intake work.
- **Their agent introduces them** — the invitee's own Claude writes the
  box a briefing about its person; the box starts half-warm. Cheap,
  novel, on-thesis.

Supporting changes from the audit: chat zero-state prompts, a first-run
dashboard state, hiding schedule internals until relevant
([schedules-off-by-default](2026-07-20-schedules-off-by-default.md)
does most of this), and whether a fresh box should even land on the
dashboard rather than the onboarding chat (the arc above implies:
chat). Related: [today-view](2026-05-11-today-view.md). The dashboard's
ops-heaviness for *established* boxes is a real but separate tension —
the boxholder's "the dashboard is crap" covers both.
