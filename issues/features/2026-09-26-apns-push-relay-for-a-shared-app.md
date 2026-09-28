---
title: "A store-distributed iOS app needs a push relay: other people's boxes cannot hold the APNs key"
workstream: unattached
area: beebox
labels: [notifications, ios]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-notifications — while landing APNs delivery (2026-09-26)
---

The notifications work (`beebox/docs/implemented-plans/notifications.md`, Track B and C)
sends APNs pushes from the box server with an APNs key in the server's
environment. That works while the app is built and installed by the same
person who runs the box. It does not work once one app, published from one
Apple developer account, pairs with boxes run by different people: the APNs
key belongs to the publisher, and a box run by someone else cannot hold it.

## What is needed eventually

A push relay: a small service the publisher runs that holds the APNs key.
A box sends it a device token and a payload; the relay forwards to Apple.
Boxes register nothing with the relay beyond what a send carries.

Privacy follows from the relay seeing every send. The usual shape (Matrix's
push gateway, UnifiedPush) is: at pairing the app hands the box a per-device
public key; the box encrypts the notification payload for the device; the
relay forwards an opaque blob; a notification service extension on the phone
decrypts before display. The relay then learns only the token and the timing.

## What the current design already allows

- The `apns` channel is behind a service interface
  (`beebox/src/services/apns.ts`) with a pure payload builder
  (`beebox/src/core/notification/apns-channel/payload.ts`). A relay is a second
  service implementation pointed at a URL, selected by configuration, not a
  new channel.
- Device registration is per box (`beebox/src/core/mobile/pairing.ts`) and
  stays so; the token is what the box sends to the relay.

## What to decide when this becomes real

- Who runs the relay and how a box authenticates to it (a per-box credential
  issued at first use, or none if every send is encrypted and rate-limited by
  token).
- Whether the payload is encrypted from day one of the relay, which changes
  the mobile contract (`beebox/docs/mobile-contract.md` §5.10) and adds a
  notification service extension to the app.
- Web push has no such problem: VAPID is per server, and the deploy seeds it.
