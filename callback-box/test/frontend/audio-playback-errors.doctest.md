# Speech media errors

The low-level buffered-audio player must reject when the browser refuses
`audio.play()`. Resolving here would make the speech machine treat a failed
segment as successfully spoken and rapidly advance through the whole queue.

```ts setup
import { playAudioBlob } from "../../src/frontend/src/lib/audio/context.js";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "doctest browser" },
  configurable: true,
});

class RejectingAudio {
  src = "";
  volume = 1;
  onplaying = null;
  onended = null;
  onerror = null;

  pause() {}

  async play() {
    throw new Error("mock browser rejected playback");
  }
}

globalThis.Audio = RejectingAudio;
```

## A rejected play is a failed segment

```ts
const playbackErrors = [];
const originalConsoleError = console.error;
console.error = (...args) => playbackErrors.push(args);
const playback = playAudioBlob(new Uint8Array([1, 2, 3]).buffer);
const result = await playback.finished.then(
  () => "resolved as success",
  (error) => `${error.name}: ${error.message}`,
);
console.error = originalConsoleError;
result
=> Error: mock browser rejected playback

playbackErrors.length
=> 1
```
