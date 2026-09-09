# Image recovery — an image whose file arrives after the message

An agent's message can point at an image that is still being written. The
first load fails, and the `file-change` refresh that would fix it needs the
box watcher to have seen the write — which a box past the watcher's directory
ceiling never does. The recovery asks the server on a bounded schedule and
hands back a stamp only once the file serves.

```ts setup
import { isRecoverableImageUrl, waitForImage, withVersionStamp, RECOVERY_DELAYS_MS } from "../../../src/frontend/src/hooks/use-image-recovery.js";

/** A fake clock: records the delays asked for, never actually waits. */
function fakeSleep(log: number[]) {
  return async (ms: number, _signal: AbortSignal) => { log.push(ms); };
}
```

Only in-box file URLs are recoverable — an external image that fails has no
file on this server to wait for, and the proxy fallback already covers it:

```ts
JSON.stringify([
  isRecoverableImageUrl("/main/test1/api/images/_content/a.attach/a.webp?width=960"),
  isRecoverableImageUrl("/test1/api/files/_content/photo.jpg"),
  isRecoverableImageUrl("https://example.com/api/files/x.png"),
  isRecoverableImageUrl("data:image/png;base64,AAAA"),
])
=> [true,true,false,false]
```

The schedule is front-loaded (a file usually lands within seconds of the
message) and finite (five minutes, then it is a broken reference):

```ts
JSON.stringify([RECOVERY_DELAYS_MS[0], RECOVERY_DELAYS_MS.length, RECOVERY_DELAYS_MS.reduce((a, b) => a + b, 0) / 1000])
=> [2000,9,307]
```

The probe stops at the first success, and the stamp is handed back only then:

```ts
const asked: number[] = [];
let calls = 0;
const recovered = await waitForImage({
  url: "/api/files/late.webp",
  probe: async () => { calls += 1; return calls === 3; },
  delays: [10, 20, 30, 40],
  signal: new AbortController().signal,
  sleep: fakeSleep(asked),
});
JSON.stringify({ recovered, calls, asked })
=> {"recovered":true,"calls":3,"asked":[10,20,30]}
```

A file that never appears exhausts the schedule and reports failure, so the
placeholder stays and nothing keeps polling:

```ts
const asked: number[] = [];
const recovered = await waitForImage({
  url: "/api/files/never.webp",
  probe: async () => false,
  delays: [1, 2],
  signal: new AbortController().signal,
  sleep: fakeSleep(asked),
});
JSON.stringify({ recovered, asked })
=> {"recovered":false,"asked":[1,2]}
```

Unmounting (or a changed source) aborts mid-schedule, and an abort is never
reported as a recovery even if the probe would have succeeded:

```ts
const controller = new AbortController();
const asked: number[] = [];
const recovered = await waitForImage({
  url: "/api/files/gone.webp",
  probe: async () => true,
  delays: [1, 2, 3],
  signal: controller.signal,
  sleep: async (ms, _signal) => { asked.push(ms); controller.abort(); },
});
JSON.stringify({ recovered, asked })
=> {"recovered":false,"asked":[1]}
```

The recovered image loads under a fresh URL. The stamp rides in `v=`, the
cache-buster the routes already accept — the image-transform route rejects
any other query key — and replaces an earlier `v=` rather than doubling it:

```ts
JSON.stringify([
  withVersionStamp("/api/files/a.png", "7"),
  withVersionStamp("/api/images/a.png?width=960&v=1#top", "8"),
])
=> ["/api/files/a.png?v=7","/api/images/a.png?width=960&v=8#top"]
```

