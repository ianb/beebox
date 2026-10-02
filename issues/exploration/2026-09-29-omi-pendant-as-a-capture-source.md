---
title: "An Omi pendant (or similar wearable) as a box capture source"
workstream: unattached
area: beebox
labels: [voice, capture, ios]
filed-by: agent
discovered-by: agent
discovered-in: worktree-omi-research — Omi review
---

Omi's pendant is a BLE microphone with an open, documented protocol. The
[Omi review](../../research/omi-review.md) (finding 5) asks whether it
could feed a box. Nothing here is needed until the boxholder wants a wearable.

## What the device offers

The protocol is in `sdks/device/PROTOCOL.md` and
`omi/firmware/omi/src/lib/core/transport.c` in the Omi repo. The audio
service is `19b10000-e8f2-537e-4f6c-d104768a1214`. Characteristic `…0001`
notifies audio, and `…0002` reads the codec. Each packet has a 3-byte header
(counter and fragment index) followed by 16 kHz mono Opus. The firmware sets
no encryption requirement on the audio characteristic; this was not tested
on hardware. The device also buffers audio offline, but its sync protocol is
not documented outside Omi's Flutter app (`app/lib/services/wals/`).

## Three routes, cheapest first

1. **Pull from Omi as a connector.** A scheduled procedure reads finished
   conversations through Omi's hosted MCP or developer API. There is no device
   code. The audio and transcript pass through Omi's cloud and arrive in
   Omi's structure, and the box gets Omi's discard decisions without seeing
   them.
2. **Omi webhook into box intake.** Omi posts each finished conversation to a
   box endpoint. The egress is the same. Omi identifies the user only by a
   `uid` query parameter, so the box endpoint needs its own secret.
3. **Direct BLE in the iOS app.** CoreBluetooth receives the audio and feeds
   the existing capture staging and HQ transcription path
   (`beebox/docs/plans/ios-native-capture-mode.md`). This is local-first and
   needs no Omi account. A BLE peripheral usually accepts one central, so
   the pendant belongs to the box or to the Omi app, not both.

## Tensions

- **Always-on versus started.** Every box voice mode today has a start the
  boxholder chooses. A pendant makes capture continuous, which brings in
  segmentation, relevance discard, and bystander consent. See
  [listening/note mode](../features/2026-08-29-listening-note-mode.md).
- **"Listening while dead."** The top complaint about Omi is a device that
  shows as connected while it records nothing. Any route needs visible device
  state and a loud gap before it is useful.
- **Egress.** Routes 1 and 2 send every conversation through a third party
  before the box sees it. That conflicts with the box owning its data, even
  though it is the cheapest experiment.
