---
title: "Quick drop has no good entry points: getting a thought, photo, or link into the box fast"
workstream: quick-chat-design
area: beebox
needs: [design]
priority: important
labels: [capture, quick-chat, ios]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-25
---

The boxholder wants a better way to quickly drop things into the box. Two
statements from the discussion:

- The iOS app goes straight into the full experience. There is no fast path
  that takes a thought and gets out of the way.
- Quick chat exists and routes a captured message to the right landmark chat
  or recent conversation (`beebox/docs/box/quick-chat.md`), but **it does not
  have the right entry points**. The boxholder: "it's a design issue, not
  entirely obvious."

So the routing half exists. What is missing is the way in: where a quick drop
starts, on which device, and what the person sees after they let go of it.

## Why this needs design

- **Many possible doors, no clear first one.** For example: the iOS share
  sheet, an App Intent (Siri, Shortcuts, the Action Button, a lock-screen or
  home-screen widget), a notification action, a keyboard shortcut or menu-bar
  item on the Mac, a web page anywhere in the app, a bookmarklet, the Chrome
  extension. Each has different constraints, such as whether it can run
  without opening the app, and whether it can take text, voice, a photo, or a
  URL.
- **What "quick" means after the drop.** The person should not have to wait,
  watch, or confirm. But a capture that succeeds silently reads as a failure
  ([capture success is invisible](../bugs/2026-08-20-capture-success-is-invisible.md)),
  and the confirmation currently lives in a chat the person has already left
  ([capture confirmation misses a user who left](../closed/features/2026-08-21-capture-confirmation-misses-a-user-who-left.md)).
  This half overlaps [notifications and proactive work](2026-09-25-notifications-and-proactive-design.md).
- **Quick chat versus capture.** Is a quick drop a message to the agent
  (Quick chat routes it to a conversation), or a capture that lands in the
  inbox for triage? The two already exist separately, and the entry point may
  have to choose, or offer both.

## Related issues

- [iOS App Intent capture via Siri / Shortcuts / Action Button](2026-08-08-ios-siri-app-intent-capture.md)
- [Share-sheet webpage and doc saves land as inert stubs](../bugs/2026-09-21-share-sheet-webpage-stub-never-completed.md)
- [Chat input everywhere](2026-08-30-chat-input-everywhere.md)
- [Jev for quick-capture routing](2026-09-21-jev-triage-and-quick-capture-routing.md)

## 2026-10-06 — current-state walk (quick-chat-design)

Checked in code, in a browser at phone width, and in the iOS simulator.

- **Quick chat is reachable from two places only.** The box selector tile, and
  a button above the native composer inside the iOS app. It has no deep link,
  no `?text=` prefill, no link from pages inside a box, and no keyboard
  shortcut. It takes text only.
- **Routing runs in the page.** `quickChat.prepare` returns a destination and
  the page then sends through ordinary chat. A caller that cannot stay open
  through both steps (an App Intent, a share extension, an offline phone)
  cannot use it. No single server operation accepts a drop and routes it.
- **A routing failure sends nothing.** The test box has no `openrouter` grant,
  so every send ends at "Quick chat needs an OpenRouter key granted to this
  box. Your message has not been sent."
- **The iOS cold launch already shows a composer** with text and microphone.
  The message goes to the last-open conversation. A first launch also raises
  the notification permission prompt over it.
- **The iOS share extension takes one URL or one text item.** It does not
  take photos or files. It dismisses without a confirmation, and a saved URL
  is the inert stub in the linked bug.
- **Capture (photo, audio, video) needs an existing chat.**
- **iOS has no App Intent, widget, or Control Center control, and no
  notification actions.** Push registration and notification-tap targets
  exist (notifications tracks A–F), untested on a real device.
- **The web manifest has no `share_target` and no `shortcuts`.** The Chrome
  extension saves a page with commentary; it has no quick note. Nothing
  exists on the Mac outside the browser.
- **A plain note to the inbox** exists only as `share.saveTextual`, called
  only by the iOS share extension.

Not driven: the Quick chat sheet inside the simulator (no tap automation was
used), the box selector page (owner login), and any real routing call.
