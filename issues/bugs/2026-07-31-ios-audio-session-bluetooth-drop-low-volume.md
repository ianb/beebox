---
title: "iOS: audio drops off Bluetooth and plays very quietly — the mic's AVAudioSession config"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder, using audio on the iOS app
needs: [manual-testing]
labels: [mobile]
---

On iOS the audio is odd: it **won't stay on a Bluetooth output** and the **volume
is very low**. The boxholder suspected the microphone, and that's right — it's the
mic's `AVAudioSession` configuration. Activating the record session for
dictation/capture reroutes and de-gains all audio.

## Cause — the audio-session category/mode/options

Two record sessions are configured wrong for output quality:

- **`SpeechDictation.swift:287-290`** (voice dictation):
  ```swift
  setCategory(.playAndRecord, mode: .measurement,
              options: [.defaultToSpeaker, .duckOthers])
  ```
- **`CaptureAcquisition.swift:632`** (audio capture):
  ```swift
  setCategory(.record, mode: .default, options: [.duckOthers])
  ```

Each symptom maps to a specific flag:

1. **Very low volume ← `mode: .measurement`.** Measurement mode strips the
   system's signal processing (AGC, gain shaping) to deliver raw, uncolored audio
   — which comes out markedly quieter on both input and output. It's for
   precise-measurement apps, not voice. Dictation wants `.default` /
   `.spokenAudio` / `.voiceChat`.
2. **Bluetooth won't stay connected ← `.defaultToSpeaker` + no
   `.allowBluetoothA2DP`.** `.defaultToSpeaker` forces output to the built-in
   speaker, overriding a connected Bluetooth device; and with **neither
   `.allowBluetoothA2DP` (high-quality output) nor `.allowBluetooth` (HFP)** in
   the options, activating a `.playAndRecord`/`.record` session makes iOS drop the
   A2DP route entirely. So starting the mic kicks audio off Bluetooth (and onto
   the quiet speaker).
3. **"Related to the microphone" ← exactly.** Both are *record* sessions;
   `setActive(true)` on them is what triggers the reroute + de-gain. When idle
   the session should return to a plain `.playback` category so playback (TTS,
   `NativeEarcons.swift`) runs full-volume over A2DP.

## Fix direction (verify on a real device + Bluetooth — audio routing is finicky)

- **Drop `.measurement`** in `SpeechDictation` → `.default` (or `.spokenAudio`).
  `.voiceChat` is an option but it forces the earpiece / BT-HFP path, so prefer
  `.default`/`.spokenAudio` if the goal is keeping A2DP output.
- **Add `.allowBluetoothA2DP`** to both sessions' options (and `.allowBluetooth`
  if bidirectional BT audio is wanted), so the BT route survives record
  activation.
- **Stop forcing `.defaultToSpeaker`** when a Bluetooth device or headphones are
  connected — only default to speaker when there's no better route.
- **Restore `.playback` when not recording** (deactivate the record session on
  stop, which `:209`/`:637` already do) so output isn't stuck at the quiet
  measurement gain.

## Verify

On a real iPhone with a Bluetooth speaker/headphones paired: play audio (TTS /
earcons) → confirm it stays on Bluetooth at normal volume; start dictation →
confirm the mic works AND audio doesn't jump to the phone speaker or go quiet;
stop → confirm output returns to Bluetooth at full volume. Can't be caught in a
headless test — needs a device and a BT accessory.

Belongs in the [iOS input-plane parity](../features/2026-07-19-ios-input-plane-parity.md)
work, which owns the native audio/composer surface.
