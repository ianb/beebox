---
title: "Turning on notifications for this browser lives in Admin; it is a personal choice and belongs in Settings"
workstream: notify-settings
area: beebox
labels: [notifications, settings, admin, ui]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder looked for desktop notifications, 2026-10-30"
---

The only place to subscribe a desktop browser to a box's notifications is
Admin's Notifications section
(`beebox/src/frontend/src/components/admin/NotificationsSection/view.tsx`).
The boxholder looked in Settings and did not find it. Turning on
notifications concerns this browser on this computer, so it belongs in the
person's own Settings, not in box administration.

On 2026-10-30, no production box had a browser push subscription: every
per-box store was `{}`. The server had its VAPID keys, so nothing was
subscribed only because nobody had found the switch.

Wanted:

- **Settings:** "Notify me in this browser" (on, off, or blocked by the
  browser, with what to do), and this phone's registration state when the
  page runs in the iOS app. Settings should say "this phone is paired but not
  registered for notifications" when that is the case (see
  [push registration refused after pairing](../bugs/2026-10-30-push-token-post-right-after-pairing-gets-401.md)),
  instead of a generic cannot-notify message.
- **Admin:** the box-wide view stays: how many phones and browsers are
  registered, recent notifications and their delivery, and test sends.

Each box keeps its own subscription list since the per-box-user layout, so
the Settings switch covers this box only. The copy should say so.

Neighbor: [notifications go to everyone](2026-10-30-notifications-have-no-recipient.md).
