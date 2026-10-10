# Live gap marker — where the live transcript went offline

When the live transcription socket drops mid-recording, the recording keeps
going and the HQ pass later fills in the words. The live transcript shows
`[…]` where live text is missing (`docs/plans/live-gap-marker.md`), so a send
in that state does not look like the box lost the words. The decisions live in
two pure pieces `TranscriptionSession` (`transcription-actor.ts`) wires
together: `ReplayRing.coversGap` (was every frame of the outage replayed?) and
`SegmentTranscript` (where the marker sits, and when it goes).

```ts setup
import { ReplayRing } from "../../../src/machines/realtime-transcription-live/transcription-replay-ring.js";
import { SegmentTranscript } from "../../../src/machines/realtime-transcription-live/transcription-segment-text.js";

function ringWith(frames: number, capacity = 100): ReplayRing {
  const ring = new ReplayRing({ capacity });
  for (let i = 0; i < frames; i++) ring.push(new ArrayBuffer(1));
  return ring;
}
```

## A covered gap: the ring still holds every frame since the outage

The replay pad (frames before the drop, re-sent for detection latency) does
not count against coverage: 95 frames after a drop fit a 100-frame ring even
though the replay sends 100 frames starting 10 before it.

```ts
const ring = ringWith(200);
ring.markGap({ padFrames: 10 });
for (let i = 0; i < 95; i++) ring.push(new ArrayBuffer(1));
JSON.stringify({ covered: ring.coversGap(), replayed: ring.sinceGap().length })
=> {"covered":true,"replayed":100}
```

An outage longer than the ring is not covered: its oldest audio is never
replayed.

```ts continue
for (let i = 0; i < 10; i++) ring.push(new ArrayBuffer(1));
ring.coversGap()
=> false
```

## A drop marks the gap after the last live words

`openGap` folds the connection's final text and appends the marker once; two
drops before any new text leave one marker.

```ts
const text = new SegmentTranscript();
text.connected({ covered: true });
text.update({ finalText: "pick up the dry cleaning", finalWords: null });
text.openGap();
text.openGap();
text.textWith("")
=> pick up the dry cleaning […]
```

## A covered reconnect keeps the marker until new words arrive

The replay has the audio, but the recognizer has not transcribed it yet. A
send in this window still shows the marker; the first non-empty final text
from the new connection removes it.

```ts continue
text.connected({ covered: true })
=> false

text.textWith("")
=> pick up the dry cleaning […]

text.update({ finalText: "", finalWords: null }).text
=> pick up the dry cleaning […]

text.update({ finalText: "and then the milk", finalWords: null }).text
=> pick up the dry cleaning and then the milk
```

## An uncovered reconnect keeps the marker for good

New text appends after it.

```ts
const text = new SegmentTranscript();
text.connected({ covered: true });
text.update({ finalText: "first part", finalWords: null });
text.openGap();
text.connected({ covered: false });
text.update({ finalText: "later part", finalWords: null }).text
=> first part […] later part
```

## Live text given up for the segment

`abandonLive` opens the gap with no reconnect to follow: the marker stays at
the end, and the segment's final text carries it to the send.

```ts
const text = new SegmentTranscript();
text.connected({ covered: true });
text.update({ finalText: "the meeting moved to", finalWords: null });
text.openGap();
text.textWith("")
=> the meeting moved to […]
```

## The first connection

Nothing is marked while the first socket opens. If it opens so late that the
replay cannot cover the wait, the marker goes at the start.

```ts
const quick = new SegmentTranscript();
quick.connected({ covered: true })
=> false

const late = new SegmentTranscript();
late.connected({ covered: false })
=> true

late.update({ finalText: "and the rest", finalWords: null }).text
=> […] and the rest
```

## Words stay with their text

The marker is text only; word lists (Deepgram confidence) merge as before.

```ts
const text = new SegmentTranscript();
text.connected({ covered: true });
text.update({ finalText: "hello", finalWords: [{ word: "hello", confidence: 0.9 }] });
text.openGap();
text.connected({ covered: false });
JSON.stringify(text.update({ finalText: "world", finalWords: [{ word: "world", confidence: 0.4 }] }))
=> {"text":"hello […] world","words":[{"word":"hello","confidence":0.9},{"word":"world","confidence":0.4}]}
```

## A second drop before any new words keeps the first gap

A covered reconnect is waiting for its first words when live text drops
again. The first outage may now lie outside the next replay, so the one
marker stays even if the next reconnect is covered.

```ts
const text = new SegmentTranscript();
text.connected({ covered: true });
text.update({ finalText: "before", finalWords: null });
text.openGap();
text.connected({ covered: true });
text.openGap();
text.connected({ covered: true });
text.update({ finalText: "after", finalWords: null }).text
=> before […] after
```

