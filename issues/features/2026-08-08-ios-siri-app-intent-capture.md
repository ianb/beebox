---
title: "iOS App Intent: capture to your box hands-free via Siri / Shortcuts / Action Button"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder asked whether we can be a Siri intent
priority: important
---

> **Job to be done:** *When my hands are busy — driving, walking the dog, mid-task
> — and a thought I need to capture arrives, I want to say "Hey Siri, add to my
> box: pick up Malik from practice at 5" (or press the Action Button and speak)
> and have it land in my box, without unlocking my phone and navigating the app.
> The capture is the whole point; the UI is friction I don't have hands for.*

**Feasible — and a good fit.** The modern mechanism is Apple's **App Intents**
framework (iOS 16+; our app's floor is already iOS 17, so no version bump). One
`AppIntent` declaration surfaces the action, for free, in **Siri (voice),
Shortcuts, Spotlight, the Action Button (iPhone 15 Pro+), and Apple Watch** —
[App Intents framework](https://developer.apple.com/documentation/appintents),
[Dive into App Intents (WWDC22)](https://developer.apple.com/videos/play/wwdc2022/10032/).
This is *not* legacy SiriKit (which required Apple-defined intent domains + a
separate extension); App Intents is the Swift-native successor Apple has invested
in since iOS 16.

## Why it fits our app specifically

The native pieces an intent needs already exist — a first version needs **no new
server endpoint**:

- **Runs hands-free.** With `openAppWhenRun = false` the intent runs without
  bringing the app to the foreground; if the app process isn't running, iOS
  background-launches the **main app target** (sceneless) to run `perform()` — so
  no separate extension is required, and the credential store is reachable
  directly (unlike the Share Extension, which needed the Keychain access group /
  App Group indirection). Budget is ~30s; a normal `URLSession` POST fits.
- **Reuses the Share Extension's send path.** The Share Extension already calls
  `POST /api/chat/send` in **exact-session mode** as isolated native code (not the
  webview) — `ShareExtensionAPI.send`, `src/webapp/routes/chat-send-target.ts`
  `assertExactSessionTarget`, mobile-contract §5.8. An App Intent reuses the same
  pattern (same "isolated native caller, not the visible webview session" framing
  that keeps it compliant with the ios-app rule against the main app calling
  chat-send behind the webview).
- **Reuses pairing + auth as-is.** `PairedBoxStore` (`selectedBox`), the
  Keychain-backed `PairedBoxCredentialStore`, `ChatAPI.resolvedSession()` →
  `GET /api/chat/default`, and the `Authorization: Bearer <token>` pattern
  (mobile-contract §2, §5.3).
- **Parameters + spoken result are first-class.** `@Parameter var text: String`
  takes the payload (typed in Shortcuts, or Siri's speech transcript by voice);
  `IntentResult & ProvidesDialog` returns a spoken "Added to your box."

## Smallest viable first slice

**"Add a note to <selected box>"** — a text `AppIntent`, `openAppWhenRun = false`,
`perform()` reads `PairedBoxStore().selectedBox`, resolves/creates a target
session, POSTs `/api/chat/send` (`exactSession: true`) like the Share Extension,
returns a spoken confirmation. New native code: the `AppIntent` struct, an
`AppShortcutsProvider` phrase ("Add to my box"), and making the send HTTP logic
target-agnostic so the intent and the Share Extension share it. **Text first** —
a voice-memo intent ("record to my box") is a bigger lift (mic access from an
App Intent has real, unresearched constraints; would reuse `SpeechDictation` or
the HQ audio path, mobile-contract §5.2).

## How it differs from what we already have

This is **not** a duplicate of the Share Extension / share-sheet capture. The
Share Extension is **reactive** — triggered from inside another app's share sheet,
UI-driven, always fed a concrete shared item. An App Intent is
**proactive/hands-free** — voice, Action Button, Spotlight, or a user-built
Shortcut, needing no other app and able to run fully invisibly. They share almost
all plumbing but are different entry points. (Related, superseded:
[ios-share-sheet-capture](2026-05-11-ios-share-sheet-capture.md),
[share-to-box-images-files](2026-03-05-share-to-box-images-files.md); the live
precedent for the credential + delivery mechanics is
[the share-extension capture plan](../../callback-box/docs/plans/ios-share-extension-capture.md),
and the contract is [mobile-contract.md](../../callback-box/docs/mobile-contract.md).)

## Open questions (for design when picked up)

- **Multi-box targeting.** Start by mirroring the Share Extension — act on the
  in-app **selected** box (`SharedSelectedBoxSnapshot`) — simple, but surprising
  if the user just switched boxes. Richer option: model paired boxes as an App
  Intents `AppEntity`/`EntityQuery` so Siri/Shortcuts can disambiguate ("which
  box?"). Lean simple for v1.
- **Hands-free failure has nowhere to go.** No native caller has an offline/retry
  queue today; a dropped call while hands-free (e.g. in a car) can only surface in
  the spoken result. Decide whether v1 needs a capture queue or just an honest
  spoken failure.
- **Lock-screen invocation.** Siri can fire intents from the lock screen;
  `PairedBoxCredentialStore` uses `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
  — fine after first unlock, but spot-check lock-screen Siri + the per-box
  `requiresDeviceUnlock` flag (`PairedBoxStore.setRequiresDeviceUnlock`) so a
  locked-required box fails/prompts rather than silently capturing.
- **Extension vs main app target.** Recommend main app target (simplest, no
  access-group indirection); revisit only if cold-launch latency becomes a
  complaint. Skip iOS 27's `LongRunningIntent` (above our floor).

## Status

A **fast-follow enhancement, not a launch gate** — iOS ships at release, but this
is a differentiator to add after. Well-scoped enough to hand to an iOS worker when
chosen.
