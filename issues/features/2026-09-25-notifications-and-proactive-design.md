---
title: "Notifications and proactive work are half built and do not work: design what reaches the person, and how"
workstream: notifications
area: beebox
needs: [manual-testing]
priority: important
labels: [notifications, proactive]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-25
---

> **⏳ Awaiting manual testing** — Tracks A–F landed on `main` in `0352baad8`.
> Automated coverage: doctests, `pnpm test:changed`,
> 11 rounds of cross-model review, a `BBX_NOTIFY_FAKE=1` / `BBX_JEV_FAKE=1`
> end-to-end walk on a scratch test-box clone, and 347 XCTests green on the
> iOS simulator with device registration verified against the test box.
> **Not** exercised: real APNs delivery to a physical iPhone, tap-to-target
> from a cold launch, and badge clearing on a real device. Only the boxholder
> can clear this.

## Manual testing

Follow [docs/notifications.md, "Verification
walk"](../../beebox/docs/notifications.md#verification-walk) on a real
iPhone. Before the walk, on the production server (`/home/beebox/.env`):

- Set `BBX_APNS_KEY_PATH` (the `.p8` key file), `BBX_APNS_KEY_ID`,
  `BBX_APNS_TEAM_ID`, and `BBX_APNS_BUNDLE_ID`.
- Confirm the app target has the Push Notifications capability enabled in
  Xcode.
- Install a Debug build on the boxholder's phone.
- VAPID keys no longer need a manual step — `deploy/deploy.sh` seeds them
  when the server env has none.

Expected: a reminder/watch notification lands on the phone, tapping it opens
the right card, and the badge clears on open.

The boxholder: notifications and proactive behavior are "like halfway done and
doesn't really work." Many of the things people want from an assistant depend
on it: a reminder before a deadline, "your flight changed", "the capture you
sent is filed", "the question you answered led to this". Without a working
way to reach the person, the box can only respond; it cannot follow up.

## What exists (checked 2026-09-25)

- **Web Push shipped and has never run.** The code merged in July
  (plan: `beebox/docs/implemented-plans/web-push-notifications.md`), but prod has no
  VAPID keys and no browser has ever subscribed. See
  [web push followup testing](../code-quality/2026-07-04-web-push-followup-testing.md).
- **The iOS app has no native notifications.** No code in `ios-app/` uses the
  notification APIs, and the iPhone app is the boxholder's main mobile surface.
- **Admin has a Notifications section**
  (`beebox/src/frontend/src/components/admin/NotificationsSection/view.tsx`), for
  the web push setup.
- **In-app signals exist:** the plate badge, question cards, and chat
  messages. They work only while the person is looking at the app.

## Why this needs design

Plumbing is only half of it. The harder half is policy.

- **What deserves an interruption.** Agent outcomes
  ([agent outcomes need a voice](../closed/features/2026-08-09-agent-outcomes-need-a-voice.md):
  "it has the conscience and not the voice"), finished captures, schedule and
  procedure results, due or overdue todos, questions waiting on the person,
  and watch-and-alert results. Each is a push notification, a badge, a
  message in the asking chat, a digest line, or nothing. Too loud trains the
  person to ignore it; too quiet is today.
- **Where it lands.** The chat that asked, a digest, the plate, or the
  notification itself, and what tapping it opens.
- **Channels.** Native iOS (APNs, needing the app and a server path) and web
  push (built but dormant) are the candidates. Email and Telegram are
  possible fallbacks. Choose one to make work end to end before adding more.
- **Proactive, not only reactive.** Beyond reporting outcomes, the agent
  starting something: a reminder at the right lead time, a nudge before a
  trigger, a morning summary. That needs a time-based trigger that ends in a
  message to the person, not only in a card.
- **Verification.** Delivery can only be proven on a real device with real
  credentials, so the design needs a test path the boxholder can run.

## Related issues

- [Capture confirmation misses a user who left](../closed/features/2026-08-21-capture-confirmation-misses-a-user-who-left.md)
- [Capture success is invisible](../bugs/2026-08-20-capture-success-is-invisible.md)
- [Agent-maintained ideas page](2026-09-25-agent-maintained-ideas-page.md): many of its ideas depend on this.
- [Quick drop entry points](2026-09-25-quick-drop-entry-points.md): a notification action is one candidate entry point.

## Re-encounter 2026-10-08 (journey walks)

Wishes and gaps from three walks, none of them a recurrence of the manual-testing items above (the walk boxes had no delivery channel, and the manual walk needs a real iPhone). [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (row 82): the walker wanted a phone notification, or to know something would prompt about the lent book on Sunday. [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (rows 10, 11, 43, 46): the agent repeated "nothing will remind you" three times, and Settings has no notification switch ("Enable notifications" exists only in Admin, `admin/NotificationsSection/view.tsx:165`). [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (rows 13, 51, 54, 59, 63, 94): the agent said the setting could be switched on "later" but could not say where; it is in Admin > Overview > Host (`AdminPage.tsx:117`), and neither the agent guide nor `box-docs` names it. A scheduled reminder has no link back from the card it concerns (row 94). Manual-testing stays.
