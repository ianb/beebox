# The native half of a UI scan

Inside the iOS shell the web page is the transcript and nothing else — the
composer, mic and capture are SwiftUI. So a scan asks the shell for its own
control registry over the V2 command envelope, waits, and either merges the
answer or says out loud that it could not reach it.

The round trip is written against an injected bridge, so all three outcomes —
the shell answers, the shell refuses, the shell never answers — are exercised
here rather than on a phone.

```ts setup
import {
  nativeScanEntries,
  requestNativeControls,
  type NativeControlBridge,
} from "../../src/frontend/src/components/chat/native-control-scan.js";
import {
  createNativeScanControlsCommand,
  type NativeControlEntry,
} from "../../src/frontend/src/components/chat/native-composer-command.js";

/**
 * A fake shell. `answer` is what it posts back on the result channel when the
 * command arrives — `null` for a shell that never answers at all, which is what
 * an installed build too old to decode the V2 envelope looks like from here.
 */
function fakeBridge(answer: ((id: string) => unknown) | null): NativeControlBridge & { posted: string[] } {
  const listeners: Array<(detail: unknown) => void> = [];
  const bridge = {
    posted: [] as string[],
    post: (id: string) => {
      bridge.posted.push(id);
      if (answer === null) return;
      const detail = answer(id);
      for (const listener of listeners) listener(detail);
    },
    subscribe: (listener: (detail: unknown) => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    // The deadline fires immediately, so "never answered" resolves without the
    // test waiting 1.5 real seconds.
    wait: (_ms: number, fire: () => void) => {
      const timer = setTimeout(fire, 0);
      return () => clearTimeout(timer);
    },
  };
  return bridge;
}

const mic: NativeControlEntry = {
  id: "cb-composer-mic",
  role: "button",
  label: "Start dictation",
  does: "hold to dictate; tap for continuous dictation",
  container: "Composer",
  disabled: false,
};
```

The command the web posts carries a non-empty `id` and no payload. That `id` is
what makes an old build's failed decode answer with a rejection instead of
returning silently.

```ts
JSON.stringify(createNativeScanControlsCommand("scan-1"))
=> {"version":2,"id":"scan-1","kind":"scan-controls"}
```

## The shell answers

```ts
const bridge = fakeBridge((id) => ({
  version: 2,
  id,
  kind: "scan-controls",
  ok: true,
  controls: [mic],
}));
const controls = await requestNativeControls(bridge, { commandId: "scan-1", timeoutMs: 50 });
JSON.stringify({ posted: bridge.posted, got: controls?.map((c) => c.id) })
=> {"posted":["scan-1"],"got":["cb-composer-mic"]}
```

A shell with nothing registered answers with an empty list, and that is a
success — distinguishable from a failure precisely because the result carries
`ok` rather than signalling by absence.

```ts
const empty = fakeBridge((id) => ({ version: 2, id, kind: "scan-controls", ok: true, controls: [] }));
JSON.stringify(await requestNativeControls(empty, { commandId: "s", timeoutMs: 50 }))
=> []
```

## The shell refuses, never answers, or answers someone else

All three resolve `null`, which the handler reports as
`coverage: "dom-native-unavailable"`. The plan requires exactly this: a refusal
and a silence are the same fact to the agent — the native controls are not in
this list.

```ts
const refused = fakeBridge((id) => ({
  version: 2,
  id,
  kind: "scan-controls",
  ok: false,
  reason: "the composer is not on screen",
}));
await requestNativeControls(refused, { commandId: "s", timeoutMs: 50 })
=> null
```

```ts
await requestNativeControls(fakeBridge(null), { commandId: "s", timeoutMs: 50 })
=> null
```

```ts
const other = fakeBridge(() => ({
  version: 2,
  id: "some-other-command",
  kind: "scan-controls",
  ok: true,
  controls: [mic],
}));
await requestNativeControls(other, { commandId: "s", timeoutMs: 50 })
=> null
```

A malformed result is not an answer either — the parser rejects it and the wait
runs out.

```ts
const malformed = fakeBridge((id) => ({ version: 2, id, kind: "scan-controls", ok: true }));
await requestNativeControls(malformed, { commandId: "s", timeoutMs: 50 })
=> null
```

## Folding the answer into the inventory

Native entries become one landmark heading its group plus the controls under it.
`actions` is empty on both: this build can list a native control but cannot
point at one yet, and the dump renders an entry with no actions without a
`control:` link rather than promising a pointer the app would break on.

```ts
JSON.stringify(nativeScanEntries([mic, {
  id: "cb-composer-send",
  role: "button",
  label: "Send",
  does: null,
  container: "Composer",
  disabled: true,
}]), null, 2)
=> [
  {
    "kind": "landmark",
    "id": null,
    "role": "native",
    "name": "Composer",
    "container": null,
    "does": null,
    "actions": [],
    "disabled": false,
    "offscreen": false
  },
  {
    "kind": "control",
    "id": "cb-composer-mic",
    "role": "button",
    "name": "Start dictation",
    "container": "Composer",
    "does": "hold to dictate; tap for continuous dictation",
    "actions": [],
    "disabled": false,
    "offscreen": false
  },
  {
    "kind": "control",
    "id": "cb-composer-send",
    "role": "button",
    "name": "Send",
    "container": "Composer",
    "does": null,
    "actions": [],
    "disabled": true,
    "offscreen": false
  }
]
```

An empty inventory produces no landmark at all: a heading with nothing under it
would read as "this surface has no controls", which is a different claim from
"native answered and had none to report".

```ts
JSON.stringify(nativeScanEntries([]))
=> []
```
