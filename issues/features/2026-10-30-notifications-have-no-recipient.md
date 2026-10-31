---
title: "Every notification goes to every registered phone and browser on the box; nothing records whose they are"
workstream: unattached
area: beebox
labels: [notifications, multi-user, identity]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder asked whether notifications are personal, 2026-10-30"
---

A box's notification audience (`beebox/src/core/notification/audience.ts`)
is every paired phone with an APNs registration plus every browser push
endpoint subscribed to the box. A notification carries no recipient, and
neither a subscription (`beebox/src/core/push-subscriptions.ts`) nor a
phone's registration records which person it belongs to; a device does have
`createdBy`. On a box several people share, everyone gets every
notification, including ones meant for one person, such as "your question is
waiting" or "solve this CAPTCHA".

Direction to weigh:

- Record the person (the signed-in identity) on each browser subscription
  and phone registration.
- Give a notification an audience: the boxholder, a named person, or
  everyone on the box. The agent and the schedules should say which.
- Settings lists your own devices; Admin shows the whole box.

This matters only for shared boxes. A single-person box behaves the same
either way. Decide when shared boxes are in active use.

Neighbor: [notification opt-in belongs in Settings](2026-10-30-notification-opt-in-belongs-in-settings.md).
