# The native half of a UI scan, and of a pointer

Inside the iOS shell the web page is the transcript and nothing else — the
composer, mic and capture are SwiftUI. So a scan asks the shell for its own
control registry over the V2 command envelope, waits, and either merges the
answer or says out loud that it could not reach it; and a `control:` link at one
of those controls hands the address back over the same envelope for the shell to
ring itself.

Both round trips are written against an injected bridge, so every outcome — the
shell answers, refuses, never answers, or answers somebody else — is exercised
here rather than on a phone.

```ts setup
import {
  nativeScanEntries,
  requestNativeControls,
} from "../../src/frontend/src/components/chat/native-control-scan.js";
import {
  requestNativePointAtControl,
} from "../../src/frontend/src/components/chat/native-control-point.js";
import type { NativeControlBridge } from "../../src/frontend/src/components/chat/native-command-bridge.js";
import {
  createNativeScanControlsCommand,
  createNativePointAtControlCommand,
  type NativeComposerCommand,
  type NativeControlEntry,
} from "../../src/frontend/src/components/chat/native-composer-command.js";

/**
 * A fake shell. `answer` is what it posts back on the result channel when the
 * command arrives — `null` for a shell that never answers at all, which is what
 * an installed build too old to decode the V2 envelope looks like from here.
 */
function fakeBridge(answer: ((command: NativeComposerCommand) => unknown) | null): NativeControlBridge & { posted: NativeComposerCommand[]; unclaimed: unknown[] } {
  const listeners: Array<(detail: unknown) => boolean> = [];
  const bridge = {
    posted: [] as NativeComposerCommand[],
    // What no listener claimed — the real bridge puts these back on the shared
    // queue rather than dropping them.
    unclaimed: [] as unknown[],
    post: (command: NativeComposerCommand) => {
      bridge.posted.push(command);
      if (answer === null) return;
      const detail = answer(command);
      const claimed = listeners.map((listener) => listener(detail)).some(Boolean);
      if (!claimed) bridge.unclaimed.push(detail);
    },
    subscribe: (listener: (detail: unknown) => boolean) => {
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
  id: "bbx-composer-mic",
  role: "button",
  label: "Start dictation",
  does: "hold to dictate; tap for continuous dictation",
  container: "Composer",
  disabled: false,
  actions: ["point"],
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
const bridge = fakeBridge(({ id }) => ({
  version: 2,
  id,
  kind: "scan-controls",
  ok: true,
  controls: [mic],
}));
const controls = await requestNativeControls(bridge, { commandId: "scan-1", timeoutMs: 50 });
JSON.stringify({ posted: bridge.posted.map((c) => c.id), got: controls?.map((c) => c.id) })
=> {"posted":["scan-1"],"got":["bbx-composer-mic"]}
```

A shell with nothing registered answers with an empty list, and that is a
success — distinguishable from a failure precisely because the result carries
`ok` rather than signalling by absence.

```ts
const empty = fakeBridge(({ id }) => ({ version: 2, id, kind: "scan-controls", ok: true, controls: [] }));
JSON.stringify(await requestNativeControls(empty, { commandId: "s", timeoutMs: 50 }))
=> []
```

## The shell refuses, never answers, or answers someone else

All three resolve `null`, which the handler reports as
`coverage: "dom-native-unavailable"`. The plan requires exactly this: a refusal
and a silence are the same fact to the agent — the native controls are not in
this list.

```ts
const refused = fakeBridge(({ id }) => ({
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

A result addressed to a different command is left alone rather than consumed —
the queue is shared, so swallowing it would strand whoever it belongs to (a
second scan, or the `point-at-control` answer that comes next).

```ts
const other = fakeBridge(() => ({
  version: 2,
  id: "some-other-command",
  kind: "scan-controls",
  ok: true,
  controls: [mic],
}));
const missed = await requestNativeControls(other, { commandId: "s", timeoutMs: 50 });
JSON.stringify({ missed, leftForItsOwner: other.unclaimed.length })
=> {"missed":null,"leftForItsOwner":1}
```

A malformed result is not an answer either — the parser rejects it and the wait
runs out.

```ts
const malformed = fakeBridge(({ id }) => ({ version: 2, id, kind: "scan-controls", ok: true }));
await requestNativeControls(malformed, { commandId: "s", timeoutMs: 50 })
=> null
```

## Folding the answer into the inventory

Native entries become one landmark heading its group plus the controls under it,
carrying the actions the shell said it can perform — so a control the shell can
only point at reads differently from the composer's text field, which it can
also focus.

```ts
JSON.stringify(nativeScanEntries([mic, {
  id: "bbx-composer-input",
  role: "textbox",
  label: "Type a message",
  does: null,
  container: "Composer",
  disabled: false,
  actions: ["point", "focus"],
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
    "id": "bbx-composer-mic",
    "role": "button",
    "name": "Start dictation",
    "container": "Composer",
    "does": "hold to dictate; tap for continuous dictation",
    "actions": [
      "point"
    ],
    "disabled": false,
    "offscreen": false
  },
  {
    "kind": "control",
    "id": "bbx-composer-input",
    "role": "textbox",
    "name": "Type a message",
    "container": "Composer",
    "does": null,
    "actions": [
      "point",
      "focus"
    ],
    "disabled": false,
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

## Pointing at a native control

The other direction over the same envelope. When a `control:` link resolves to
nothing in the DOM and the shell is present, the address goes to the shell,
which rings its own view or says why it will not.

The command names the control and the action; the envelope's own `id` is the
command id, and the payload's `id` is the `bbx-` address.

```ts
JSON.stringify(createNativePointAtControlCommand("point-1", { id: "bbx-composer-mic", action: "point" }))
=> {"version":2,"id":"point-1","kind":"point-at-control","payload":{"id":"bbx-composer-mic","action":"point"}}
```

A shell that drew the ring answers `ok` and nothing else — there is no
inventory to return, only the fact that it happened.

```ts
const drew = fakeBridge(({ id }) => ({ version: 2, id, kind: "point-at-control", ok: true }));
const outcome = await requestNativePointAtControl(drew, {
  commandId: "point-1",
  controlId: "bbx-composer-mic",
  action: "point",
  timeoutMs: 50,
});
JSON.stringify({ posted: drew.posted.map((c) => c.kind), outcome })
=> {"posted":["point-at-control"],"outcome":{"ok":true}}
```

Every refusal comes back with the shell's own sentence, which the pointer shows
in its broken treatment. An address the shell does not hold:

```ts
const unknown = fakeBridge(({ id }) => ({
  version: 2,
  id,
  kind: "point-at-control",
  ok: false,
  reason: 'The app has no control "bbx-nav-voice" on screen right now.',
}));
JSON.stringify(await requestNativePointAtControl(unknown, {
  commandId: "point-2",
  controlId: "bbx-nav-voice",
  action: "point",
  timeoutMs: 50,
}))
=> {"ok":false,"reason":"The app has no control \"bbx-nav-voice\" on screen right now."}
```

…and an action that control has no native meaning for. `focus` exists on the
composer's text field and nowhere else on this surface, so asking a button for
it is refused rather than quietly turned into a `point`.

```ts
const unsupported = fakeBridge(({ id }) => ({
  version: 2,
  id,
  kind: "point-at-control",
  ok: false,
  reason: "focus is not supported for this control on this surface (bbx-composer-mic).",
}));
JSON.stringify(await requestNativePointAtControl(unsupported, {
  commandId: "point-3",
  controlId: "bbx-composer-mic",
  action: "focus",
  timeoutMs: 50,
}))
=> {"ok":false,"reason":"focus is not supported for this control on this surface (bbx-composer-mic)."}
```

A shell that never answers is reported as a timeout rather than as a refusal:
it may well have drawn the ring and lost the reply, so the sentence says what is
actually known.

```ts
JSON.stringify(await requestNativePointAtControl(fakeBridge(null), {
  commandId: "point-4",
  controlId: "bbx-composer-mic",
  action: "point",
  timeoutMs: 50,
}))
=> {"ok":false,"reason":"The app did not answer in time, so this control could not be pointed at."}
```

An answer to somebody else's command is left on the shared queue for its owner —
the same non-destructive rule the scan follows, and the reason a scan and a
pointer can be in flight at once.

```ts
const crossed = fakeBridge(() => ({
  version: 2,
  id: "some-other-command",
  kind: "point-at-control",
  ok: true,
}));
const missed = await requestNativePointAtControl(crossed, {
  commandId: "point-5",
  controlId: "bbx-composer-mic",
  action: "point",
  timeoutMs: 50,
});
JSON.stringify({ missed, leftForItsOwner: crossed.unclaimed.length })
=> {"missed":{"ok":false,"reason":"The app did not answer in time, so this control could not be pointed at."},"leftForItsOwner":1}
```

A `scan-controls` answer under the pointer's own command id is not the pointer's
answer either — the kind is matched, not just the id, so a shell answering the
wrong question cannot be read as the right one.

```ts
const wrongKind = fakeBridge(({ id }) => ({
  version: 2,
  id,
  kind: "scan-controls",
  ok: true,
  controls: [],
}));
JSON.stringify(await requestNativePointAtControl(wrongKind, {
  commandId: "point-6",
  controlId: "bbx-composer-mic",
  action: "point",
  timeoutMs: 50,
}))
=> {"ok":false,"reason":"The app did not answer in time, so this control could not be pointed at."}
```
