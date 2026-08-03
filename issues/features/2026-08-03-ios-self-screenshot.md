---
title: "Add self-screenshot to the iOS app (the agent-visible screen capture clerk gives on desktop)"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder wants the clerk screenshot ability on iOS
---

Give the iOS native app the ability to **screenshot its own current view** and feed
it into chat, mirroring the "let the agent see what I'm looking at" capability that
**clerk** already provides on desktop. iOS has no equivalent today, so the agent is
blind to the user's iOS screen.

## What exists on other surfaces

- **Web** — "Send screenshot…" (`components/chat/ScreenshotMenuItem.tsx` →
  `screenshot-capture`) does a one-frame `getDisplayMedia` grab of the current view
  and feeds the PNG into the chat attachment path. But it needs a browser share
  prompt each time and **renders nothing on mobile web** (`getDisplayMedia` is
  unavailable there).
- **Clerk** (Chrome extension) — provides **silent agent screenshots**:
  `chrome.tabs.captureVisibleTab` grabs the box tab with no prompt, gated behind an
  opt-in "Silent screenshots" toggle (`callback-clerk/src/platform/capture-permission.ts`,
  `entrypoints/background.ts:173`, `ui/settings-app.tsx`). This is the "agent sees
  your box" capability the boxholder wants on iOS.
- **iOS** — nothing. The agent cannot see the user's iOS screen at all.

## Why iOS is actually the easy surface

A native app can snapshot **its own** view hierarchy / window trivially and with **no
permission and no share prompt** (unlike web `getDisplayMedia`, and unlike capturing
*other* apps which would need ReplayKit). So the friction that makes web screenshots
awkward on mobile does not apply — iOS can do the clean version.

## Job to be done

When the boxholder is looking at something in the iOS app and wants the agent to act
on what's on screen, they want it captured directly — the way clerk lets the agent
see their box tab on desktop — instead of describing it in words or finding the
mobile-web screenshot missing.

## Design questions

- **Agent-initiated (silent) vs user-initiated.** Clerk's headline is the *silent
  agent* screenshot (the agent asks, the app provides). Mirror that via the native
  emission bridge — the agent requests a screenshot and the app returns the current
  view. Also offer a user-initiated "Send screenshot" affordance (the mobile-web
  equivalent that's currently hidden). Decide which lands first.
- **Native capture mechanism.** A UIView/window snapshot of the app's current view;
  feed the PNG into the same chat attachment path the web screenshot uses.
- **Privacy / opt-in.** Capturing the user's screen is sensitive; clerk gates the
  silent path behind an opt-in toggle. iOS should have equivalent consent, especially
  for the agent-initiated silent case.
- **Overlap.** This mirrors web + clerk surfaces — cb-ios-overlap territory; fit it
  into the native bridge + `docs/mobile-contract.md`.
