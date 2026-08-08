---
title: "Seeded schedules stay disabled until the user activates them"
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — first-run UX audit for the soft launch
labels: [soft-launch]
---

> **Decision recorded 2026-08-07** — Fresh boxes enable `refresh-maps` and
> `gc-procedure-runs`. The other four seeded schedules remain disabled until
> the boxholder opts in. `refresh-maps` is not purely mechanical: when the
> directory structure changes, it may invoke a Haiku agent, and its first run
> on a fresh box can create the full map tree. The boxholder accepts that
> cost. Existing boxes keep their current box-owned schedule state.

At filing, a fresh `cb init` box shipped five scheduled scripts with three **enabled**
(`refresh-maps`, `gc-procedure-runs`, `process-retrospective` —
`src/core/box/defaults.ts:208-273`). Boxholder decision (2026-07-20):
**keep schedules down or nil until activated by the user** — including
activation via the agent ("turn on the retrospective" in chat is fine;
silent default-on is not).

Why: a brand-new box that runs jobs the user never asked for (a) burns
their Claude subscription quota invisibly — cost-trust matters for the
soft-launch audience, (b) fills the dashboard's schedule table with
unexplained cron/budget internals as the first thing a new user sees
(see [first-run-experience](2026-07-20-first-run-experience.md)), and
(c) contradicts the system's own consent-and-teaching ethos.

The original proposal was to seed all schedules `enabled: false`; activation becomes part of
onboarding ("want me to turn on the nightly retrospective?") rather than
a default. Check what actually degrades with housekeeping off
(`refresh-maps` staleness, procedure-run GC) and whether those two
should instead run lazily/on-demand rather than on cron, so nothing
needs to be on by default.

## Resolution details (2026-08-07)

`refresh-maps` keeps directory maps reasonably current, and
`gc-procedure-runs` bounds expired run-cache retention. The four schedules that
can sync user services or spend agent quota remain disabled until activated:
`check-email`, `check-calendar`, `process-retrospective`, and `chat-review`.

The map refresh is the accepted exception to the no-surprise-cost default. It
may invoke a Haiku agent whenever directory structure changes, with the first
run on a fresh box creating the whole map tree. The original proposal asked
whether these schedules should run lazily or on demand; this decision keeps
their cron scheduling and does not add a lazy execution path.

This resolution applies only to seeded defaults for **new** boxes. Existing
boxes are grandfathered: `cb init` and template sync preserve their current
box-owned `enabled` state rather than retroactively changing it.
