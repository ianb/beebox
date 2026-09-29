---
title: "The iOS record button doesn't change with narration mode or voice state the way the web button does"
workstream: unattached
area: ios
labels: [voice]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report, 2026-09-29
---

On web, the record button shows which mode and state voice input is in. The native iOS composer's button does not. The boxholder noticed it most in narration mode.

## Web (`beebox/src/frontend/src/components/chat/InteractiveChat-composer/InteractiveChat-voice-button.tsx`)

- Idle: filled primary circle with a microphone icon.
- Narration mode, idle: the same circle with `NarrationMicIcon` (microphone plus chat bubble, `InteractiveChat-controls.tsx`). The title says "narration mode".
- Recording: filled red circle with a white stop square.
- Paused while the agent speaks (`voicePaused`): half-opacity primary, pulsing, with a pause badge. Tapping it resumes.
- The live/HQ state appears in `MicOverlay` above the button (`InteractiveChat-composer/view.tsx`).

## iOS (`ios-app/BeeBox/Views/NativeComposerView.swift`, `trailingControl` / `microphoneButton`)

- Idle: `mic.fill` on a grey tertiary-fill circle.
- Recording: a red `stop.fill` glyph on the same grey circle, with no red fill.
- Starting and sending show a spinner.
- There is no narration icon, no paused state, no overlay, and no animation.

## The mode already reaches iOS

Web posts `beeboxNarrationState {enabled}` ([mobile contract](../../beebox/docs/mobile-contract.md) §4.4). `ChatWebView.swift` parses it, `RootView.swift` stores it, and `NativeComposerView` receives it as `narrationEnabled`. Today it only picks live transcript vs HQ audio for a keyword send (`SpeechKeywords.swift`). So the fix is display-only; the bridge doesn't need to change.

Whether the paused state has a native counterpart needs checking: the native `voiceTurn` and speech-playback state exist, but nothing drives the button's look from them. The fix should match the web states rather than invent new ones. This is a shared surface, so use the bbx-ios-overlap skill.
