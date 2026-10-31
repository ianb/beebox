---
title: "Notification opt-in in Settings"
status: draft
workstream: notify-settings
issues:
  - ../../../issues/features/2026-10-30-notification-opt-in-belongs-in-settings.md
---
# Notification opt-in in Settings

Move "notify me here" from Admin to Settings, where people look for it, and show a paired phone its own registration state. Admin keeps the box-wide view.

**Issues addressed:** [opt-in belongs in Settings](../../../issues/features/2026-10-30-notification-opt-in-belongs-in-settings.md). Neighbors left open: [no recipient](../../../issues/features/2026-10-30-notifications-have-no-recipient.md), [push token 401](../../../issues/bugs/2026-10-30-push-token-post-right-after-pairing-gets-401.md).

## Design

### Situations

- When Tomas sits at his laptop and wants the box to tap him when a question waits, I want the switch under Settings, so I can turn it on without knowing Admin exists.
- When Priya clicked "Block" on the browser's prompt months ago, I want the page to say the browser is blocking this and where to change it, so I can fix it myself.
- When Diana opens Settings in the phone app because no notification ever arrived, I want to see whether this phone is registered and what to do if not, so I am not guessing.
- When Tomas uses a shared computer and does not want notifications there, I want the switch to stay off until he asks and to be easy to turn off, so nothing pops up on it.
- When Priya checks why nobody got an alert, I want Admin to show how many phones and browsers the box can reach, what happened to recent notifications, and a test send, so I can see the box's side.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Laptop opt-in | Show; acts on click only | Settings card, Notifications section | Waits to be found |
| Blocked by browser | Show state and the fix | Same section | Waits to be found |
| Phone not registered | Show state and the fix | Same section, in the app | Waits to be found |
| Does not want it | Quiet: off by default, no nag | Same section | None |
| Box-wide check | Show | Admin, Notifications section | Waits to be found |

### Spirit

- **Serves:** "see the gears": the page states the true registration, and the box it covers.
- **Risks:** "feel like a place", through status-page jargon. Guard: the copy says what the person gets and does; "APNs" and "VAPID" stay out of Settings.

### Trust

The browser switch acts only on a click, and the browser's own prompt confirms it. The phone state and the Admin counts show only. A test send acts on a click by the owner, and appears in Recent.

### When it goes wrong or does nothing

- **Browser off:** a button and a line saying this covers this box only.
- **Browser blocked:** names the browser's site settings, then reload.
- **No web push (old browser):** says so. iPhone Safari keeps its Add to Home Screen coaching.
- **Server has no key:** says the server is not set up to send to browsers, or to phones; asks the person to tell whoever runs the box.
- **Phone unregistered:** "This phone is paired but not registered for notifications. Switch away from the Bee Box app and come back. If this stays, check that notifications are on for Bee Box in iPhone Settings."
- **App session has no device behind it** (signed in with a password inside the app): says this app is not paired with this box, and to pair from this page's Companion section.
- **Phone unregistered and server has no key:** says both, and to tell whoever runs the box; reopening would not help.
- **Registered phone with iOS permission later denied:** the box cannot see this, so the registered line says to check iPhone Settings if nothing appears.
- **Enable fails:** the error appears in place.

### Walkthrough

Diana's phone pairs; its first push-token post fails. She opens Settings in the app. The page sees the native shell, asks `pairing.thisDevice`, and shows the unregistered line. She switches away and back. `PushRegistrar.sceneDidBecomeActive` posts again, the query refetches on focus, and the line reads "This phone is registered for notifications from this box."

## Smallest fix and budget

Smallest fix: render the existing opt-in JSX in Settings. That leaves the iOS shell showing Add to Home Screen coaching (`push-support.ts:37`), and a turned-off browser reading "on" after reload (below). Chosen: one track, about 300 source lines and 120 test lines changed.

## Stated preferences this plan trades against

`beebox/AGENTS.md`: *"Work only on the requested problem."* Test send and the server-side subscribed check are the two additions; the first is asked for by name, the second is what makes "on" and "off" true. Engineering principle 13 (`RootView.swift:1000`: *"never implies a phone that cannot be reached is reachable"*) is what the phone state serves.

## What already exists

- `NotificationsSection/view.tsx:30-104`: the opt-in logic. Moved into a hook, not copied.
- `lib/push-support.ts:31`: `detectPushSupport`. Reused.
- `core/mobile/request-auth.ts`: `MobileRequestAuth` carries `deviceId`; `server-box-scope.ts:251` resolves it, and the tRPC context drops it. Add it to the context.
- `core/mobile/pairing.ts:131`: `listMobileDevices` gives `push` without the token. Reused.
- `native-post.ts:42`: `isNativeShell`. Reused; no bridge change.
- `core/push-subscriptions.ts`: `endpointsForBox`. Reused for count and subscribed check.
- `notifications.send`, `apnsStatus`: reused for test send and the no-key line.

**Defect found in the opt-in logic:** `disable` removes the endpoint server-side and deliberately keeps the browser subscription (`view.tsx:96`), while the page reads "on" from `pushManager.getSubscription()` (`view.tsx:49`). After a reload a turned-off browser reads "on". A pruned endpoint reads "on" too. So "on" now requires the server to hold the endpoint.

**"Can't notify" text:** searched `src/`, `templates/`, `box-docs/`, and `ios-app/BeeBox` for can't/cannot/unable near notify; no such text exists, and `_config/interface/settings.card` has an empty body on the test box. No source line to correct. The nearest native text is "Notifications off" (`RootView.swift:1005`), which appears only when iOS permission is denied. The new section replaces any guessing.

## Prior art (external)

No decision depends on a new external premise; the Safari re-subscribe trap is already recorded at `view.tsx:8`.

## Ontology

Adds no card or shared vocabulary. `subscribedBy` on a browser subscription: the signed-in person who turned it on, the counterpart of a phone's `createdBy` (boxholder, 2026-10-30: keep track of which person is on which channel, with routing still out of scope). `TrpcContext.mobileDeviceId`: the paired device behind this request, or null. `BrowserPushState` and `PhonePushState`: closed frontend unions naming what Settings shows.

## Tracks / scope

One track.

- **What:** server reads for this device and the subscriber list; a shared hook; a Settings section; Admin changed to box-wide.
- **Why this needs to change:** nobody found the switch; no production box had a browser subscription.
- **Direction:** `pairing.thisDevice` → `{ device: { id, label, push } | null }`. `push.isSubscribed({ endpoint })` → `{ subscribed }`. `push.subscriberCount` → `{ count }`. Hook `useBrowserPush()` returns `{ state, busy, error, enable, disable }`. Pure `browserPushState` and `phonePushState` in `lib/push-support.ts`. Admin section scope becomes `box`.
- **Vocabulary lock-ins:** none beyond the above.
- **First implementation chunk:** the procedures and context field with router tests.

## Could this be simpler?

Simplest: Admin links to a copied switch. It fails on the iOS shell and the false "on". Dropping the phone state fails the human's request. A native bridge reporting iOS permission would be more exact but is not needed: the server's registration record is what decides delivery, and the copy covers permission as the second step.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Browser reads on after server removal | Yes, `browserPushState` plus `isSubscribed` | Yes | Clear |
| Native shell gets Add to Home Screen coaching | Yes, section branches on `isNativeShell` first; seen in exhibit | Yes | Clear |
| `thisDevice` returns another phone | Yes, router test with two devices | Identity comes from the signed credential | Clear |
| `thisDevice` leaks the APNs token | Yes, router test | `listMobileDevices` strips it | Clear |
| Subscriber store corrupt | Existing `PushStoreCorruptError` | Query error shown in section | Clear |
| Test send reaches nobody | Delivery lines in Recent | `no-audience` shown | Clear |

## Agent-flow / user-flow edge cases

Cards, tags, and agents are untouched, so wrong tag, stale ref, two agents, hand-edit drift, fabricated value, and validation error UX do not arise. Partial rollout: an old iOS build still loads the same web page; no native change. ADDRESSED: a member sees Settings with their own state; Admin stays owner-gated as today.

## NOT in scope

- Per-person routing: separate issue.
- The push-token 401: separate issue.
- A bridge for iOS permission state: the copy covers it.
- Moving Notifications to another Admin tab: no reported need.

## Open design questions

None.

## Knowledge audits

Skipped: no agent-facing concept changes.

## What will hold this after it ships

Router tests for the procedures; unit tests for the two state functions and the Admin count summary. Those functions hold the decisions, so no browser test tier is added.

## Implementation order

1. Context field, procedures, router tests.
2. State functions, hook, Settings section, Admin changes, unit tests.
3. Contract doc line, exhibit.

## Rollout shape

Done when the router and frontend tests pass and the exhibit shows each state. No migration. The contract's §5.9 Drift line names Settings too.
