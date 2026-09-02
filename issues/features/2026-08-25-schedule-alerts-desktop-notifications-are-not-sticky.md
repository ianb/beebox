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

> 2026-09-02 (main session, boxholder re-report): confirmed still true, and
> two more findings.
>
> - Delivery is now `terminal-notifier` (`osascriptNotify`), sender
>   `fr.julienxx.oss.terminal-notifier`. `com.apple.ncprefs` shows that sender
>   with the banner bit set and the alert bit clear (flags 41951246: bit 8 on,
>   bit 16 off), so notifications still auto-dismiss. Option 1 applies to the
>   terminal-notifier sender, not Script Editor; `bin/doctor` could read that
>   flag.
> - `-group callback-schedules` removes the previous notification whenever a
>   new one posts, so at most one schedule alert ever survives in Notification
>   Center, even before it expires. A per-alert group (the alert id) keeps them.
> - **Click target.** `-open` points at the workstreams app root. The
>   boxholder wants the click to land on the specific report: the alert itself
>   (needs an alert deep link, e.g. `/workstreams/?alert=<id>` scrolled and
>   highlighted in the Scheduled section), the filed issue when the message
>   names one (the issues page has an `issue=` search param), or the run log
>   (`bin/schedules logs <name> --run <id>` has no web route yet). `notify()`
>   receives only title and message today; it needs the alert id, and
>   optionally an issue path, to build the URL.
