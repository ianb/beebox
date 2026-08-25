---
title: "Schedule alert notifications vanish; they need to be sticky"
workstream: unattached
---
`bin/schedules alert` delivers via `osascript display notification`
(`bin/lib/schedules-alerts.ts` → `osascriptNotify`). macOS shows that as a
banner that auto-dismisses in seconds, so an alert raised while the boxholder
is away is gone before it is seen. The durable record exists (the alert file
in the store, surfaced with ack in the workstreams app's Scheduled section),
but the nudge that points at it does not persist.

Options, cheapest first:

1. **System setting, no code.** `display notification` posts under the
   "Script Editor" identity; System Settings → Notifications → Script Editor →
   alert style *Alerts* makes them stay until dismissed. Per-machine, per-user;
   nothing in the repo can set it, so `bin/doctor` could at least detect and
   name it.
2. **A notifier that supports persistence** (e.g. `terminal-notifier` with a
   dedicated sender/bundle whose style is Alerts, or a tiny signed helper app),
   still fire-and-forget from `osascriptNotify`.
3. **Re-nudge from the tick.** Open, unacknowledged alerts get re-posted on
   each 15-min tick (bounded — `priority: fyi` once, `important` until acked),
   so persistence comes from the store rather than the notification center.
   Fits "the record is the truth; the notification is one best-effort
   delivery" already stated in `schedules-alerts.ts`.

Related: 2026-08-25 the tick itself failed for a day (empty unmarked store dir)
and could raise no alert about it because the store is where alerts go — a
tick-can't-start failure needs a delivery path that doesn't depend on the store.
