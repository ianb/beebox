---
title: "scheduled task health surfacing"
area: callback-box
resolution: implemented
---

**Closed (2026-07-15): implemented** — as the body's "IMPLEMENTED (June 2026)"
note details: `cb health` (always-available, exit 1 when unhealthy), a `health`
attribute on the session-start `<chat-app>` snapshot, proactive scheduler-daemon
telegram alerts, and a per-box heartbeat. Confirmed live this session — `cb health`
surfaces failing/overdue/blocked per box. Only the optional dashboard panel
remains; not worth holding the issue open (refile if wanted).

Scheduled automation (wakeup, scheduler ticks, overnight compaction once that exists, sync jobs) can silently stop running, and the failure isn't noticed until something downstream breaks (briefings stop updating, hunches stop being extracted, calendar drift). Stuff gets lost.

Primary mechanism should be *active monitoring*: each scheduled task records `last_run_attempted` and `last_run_succeeded` (which can diverge — see the same shape in the cache-freshness audit). Anything overdue past threshold or failing repeatedly triggers proactive notification, independent of any session.

Session-start surfacing is the *backup* layer: if you missed the proactive alert, the next chat session opens with a brief health-check note. Only surface when there's something to surface — "all green" every session is noise. Threshold: any task that's overdue, failed, or has been failing repeatedly.

Notes:
- This is the process-shape of the cache-freshness pattern. `data_through` for data; `last_run_succeeded` for tasks. Same divergence trick (attempted vs. succeeded ≈ checked vs. found-fresh-data).
- Should also be visible somewhere as an always-available view (status page, `cb health`) so it doesn't *only* surface at session start.
- The reason the agent should still check at session start, even with proactive alerting in place: catches bugs in the alerting itself. Belt and suspenders.

**IMPLEMENTED (June 2026)** — `src/core/schedule-health.ts` evaluates each task (ok/failing/overdue/blocked/invalid/disabled) from its card + run state (`lastRun`/`lastSuccess` divergence, consecutive failures); overdue derives from the task's own cadence (grace = half-cadence clamped to 30m–24h), and deliberate skips (budget, missing connector, disabled) are never mislabeled as failures. Surfaces: `cb health` (always-available, exit 1 when unhealthy), a `health` attribute on the session-start `<chat-app>` snapshot (only when something is wrong), and proactive alerts from the scheduler daemon — one aggregated telegram-message card per unhealthy episode (latched until the next success), opt-in via `healthAlerts.telegramChat` in `config/box.json`. The daemon also writes a per-box heartbeat so a dead scheduler is itself a finding. Remaining: a dashboard panel (the tRPC health router could reuse the same evaluator).
