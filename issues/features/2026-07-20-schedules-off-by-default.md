---
title: "Seeded schedules stay disabled until the user activates them"
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — first-run UX audit for the soft launch
---

A fresh `cb init` box ships five scheduled scripts with three **enabled**
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

Shape: seed all schedules `enabled: false`; activation becomes part of
onboarding ("want me to turn on the nightly retrospective?") rather than
a default. Check what actually degrades with housekeeping off
(`refresh-maps` staleness, procedure-run GC) and whether those two
should instead run lazily/on-demand rather than on cron, so nothing
needs to be on by default.
