---
title: "Quick drop has no good entry points: getting a thought, photo, or link into the box fast"
workstream: unattached
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
  ([capture confirmation misses a user who left](2026-08-21-capture-confirmation-misses-a-user-who-left.md)).
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
