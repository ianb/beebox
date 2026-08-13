---
title: "Evaluate Deepgram Flux — conversational STT, TTS, and turn-taking"
workstream: unattached
area: callback-box
needs: [design]
labels: [research, voice, deepgram]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder note
---

Deepgram has a **Flux** family worth looking at: Flux STT, Flux TTS, and
built-in turn-taking. We already use Deepgram
(`src/core/transcription/deepgram.ts`, with a `deepgram-key.ts` on the frontend
audio side), so this is evaluating a newer model from an existing vendor rather
than adding one.

## What it claims to be

From Deepgram's own material (verify against docs before designing anything):

- **Flux STT** is pitched as conversational speech recognition built for voice
  agents rather than transcription — understanding conversational flow and
  handling **turn-taking and interruptions** natively, which they frame as *the*
  problem in voice agents.
- **Flux TTS** is "conversation-native" text-to-speech, holding tone,
  expression, and continuity across a whole session. Notable implementation
  detail: a **Mamba state-space backbone with fixed-size memory**, so
  session-long context doesn't carry quadratic cost.
- The two run as **one integrated stack on a single connection**, with Deepgram
  orchestrating the timing between listening and speaking.
- Free tier for building through 2026-09-12 (45 concurrent streaming
  connections globally, 5 in EU/AU) — so an evaluation is cheap if done soon.

## Why turn-taking is the interesting part here

Turn-taking is where callback-box's voice UX actually hurts, and the evidence is
already filed:

- **"clear message" stops the microphone on iOS** but not on web — a spoken
  keyword ending the turn when it shouldn't (fixed in the `ios-clear-mic`
  workstream, 2026-08-12; the `.erase` intent emitted
  `applyVoiceTurn(.microphoneStopped)`, the same transition `.micOff` uses
  deliberately).
- The keyword vocabulary itself (`SpeechKeywords.swift`) is a **hand-rolled
  turn-taking layer**: `send and close`, `send and stop`, `mic off`, `erase` —
  spoken commands compensating for a recognizer that doesn't know when a turn
  ended.
- Narration mode, earcons, and the mic-tab lock (`mic-tab-lock.ts`) are all
  scaffolding around "who is speaking now".

If Flux handles turn detection natively, some of that hand-rolled layer could
retire. That's the question worth answering — not "is the transcription better".

## "Turn-taking" bundles three things; only one takes the loop away

The boxholder's objection is the right one: *it would have to control the loop.*
That is true of exactly one of the three adoptions hiding under the phrase, so
evaluate them separately rather than as a package.

**The assumption to check first:** Deepgram's voice-agent framing assumes a
partner that replies in a few hundred milliseconds — stop speaking, detect
end-of-turn, LLM answers, TTS speaks, repeat. **A callback-box turn is not
that.** It's a Claude Code SDK session that can run for tens of seconds, call
tools, and edit files. After the user stops speaking there's a long silence that
isn't the other party thinking — it's work running. A turn-taking model watching
that gap would conclude the user should speak again.

**1. End-of-turn detection for dictation — doesn't touch the loop.** Flux decides
*when the user finished speaking a message*, replacing the send button and the
spoken keywords. This swaps one signal for another; the app still owns what
happens next. Smallest adoption, and aimed exactly at the hand-rolled keyword
layer above. **Probably worth it.**

**2. Barge-in during narration — real turn-taking, but orthogonal to agent
latency.** While a reply is being read aloud, the user speaks and playback stops.
The contested resource is the *speaker*, not the agent, so the agent's slowness
is irrelevant. Needs the mic live during TTS and a fast "user started speaking"
signal. `mic-tab-lock.ts` and the earcon machinery are already circling this.
**Probably worth it.**

**3. The full duplex stack — this is the one that takes the loop.** Flux STT and
TTS on one connection with Deepgram orchestrating listen/speak timing means the
vendor owns the conversation clock. Today the app owns it: the voice-turn state
machine, `applyVoiceTurn(...)`, the mic lock, the keyword intents. Handing that
over while the agent runs on a completely different timescale is adopting an
orchestration layer for a conversation that isn't happening at conversational
speed. **Probably not a fit.**

### So the decisive research question

**Can end-of-turn detection and barge-in be consumed standalone** — as plain
events on an ordinary streaming STT connection that the app reacts to — or are
they only coherent inside Deepgram's agent stack? If it's the latter, 1 and 2
aren't actually available separately and the answer collapses to 3.

Also verify behaviour on **the dictation patterns this boxholder actually
produces**: thinking aloud, mid-sentence corrections, long pauses while
composing. A model tuned for phone-call cadence may cut him off constantly,
which would be worse than the button it replaced.

## What an evaluation should establish

- **Turn-taking**: does its end-of-turn detection actually beat the current
  keyword-plus-heuristics approach, on real dictation with pauses, thinking
  aloud, and mid-sentence corrections?
- **Where it runs.** The iOS app currently uses on-device `SpeechAnalyzer` with a
  legacy `SFSpeechRecognizer` fallback. Flux is a streaming cloud service, so
  adopting it for dictation is a **privacy posture change** — there's already a
  filed concern about the legacy fallback streaming audio to Apple, and this
  would be streaming to Deepgram deliberately. Name that trade explicitly.
- **Does Flux STT replace or complement Voxtral?** `cb chat retranscribe` runs a
  high-quality pass; that's a different job (accuracy on demand) from live
  conversational STT, and they may coexist.
- **TTS**: what do we use today, and is session-long tonal continuity worth
  switching for? Narration is the obvious consumer.
- **Cost and failure modes** — a single connection carrying both directions is
  elegant until it drops.

Land findings in `research/` per `research/CLAUDE.md`, then link back with a
recommendation.

Sources: [Introducing Flux](https://deepgram.com/learn/introducing-flux-conversational-speech-recognition),
[Flux TTS](https://deepgram.com/learn/introducing-flux-tts-conversation-native-text-to-speech-for-real-time-voice-agents),
[Flux docs](https://developers.deepgram.com/docs/flux/quickstart).
