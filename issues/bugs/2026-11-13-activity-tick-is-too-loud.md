---
title: "The clicking while the agent works can be too loud and grating"
workstream: unattached
area: beebox
discovered-by: Ian
filed-by: agent
---

While the agent works on a reply, the chat plays a repeating click. The developer reports that it can be too loud and that it grates.

## What the code does

- The click is the `tick` earcon in `beebox/src/frontend/src/lib/audio/earcons.ts`. It plays `tick2.wav` at volume 0.6. The other routine cues are quieter: `sendSound` is 0.3, `stillListening` is 0.3 and `liveTextPaused` is 0.3.
- `voice-keyword-send.ts` in `beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/` starts it after a voice send, with `tick.repeatPlay(1000, 30000)`: one click each second for up to 30 seconds.
- `speech.ts` in the same directory stops it when the reply's stream ends.

## Tension

The click tells a person who is not looking at the screen that the box heard them and is working. It repeats each second for as long as 30 seconds, at twice the volume of the other routine cues. So it is noticeable at the start, and then it goes on too long.

## Directions (not decided)

- Lower the volume, to about the 0.3 that the other routine cues use.
- Use a softer sound.
- Make the clicks less frequent, or fade them out over time.
- Stop the clicks when the first speech or text of the reply arrives, instead of at the end of the stream.

## Not yet checked

- Whether "too loud" applies on all output devices, or mainly on some, for example a phone speaker or headphones.
- Whether iOS plays its own version of this cue.
