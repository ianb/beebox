# Native composer selection commands

The web sends a strict, versioned selection intent through the neutral native
transport and strictly parses the native durability acknowledgement.

```ts setup
import {
  createNativeAddSelectionCommand,
  nativeCommandResultFromDetail,
  nativeComposerCommandAcknowledgementFromDetail,
  nativeComposerCommandFromDetail,
  postNativeComposerCommand,
} from "../../src/frontend/src/components/chat/native-composer-command.js";
import type { NativeShellWindow } from "../../src/frontend/src/components/chat/native-post.js";
```

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  callbackboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeComposerCommand(shell, createNativeAddSelectionCommand("command-1", {
  ref: "/notes/plan.md",
  text: "Ship the native path",
  position: "body; paragraph 2",
}));
calls
=> [
  {
    "channel": "callbackboxComposerCommand",
    "payload": "{\"version\":1,\"id\":\"command-1\",\"kind\":\"add-selection\",\"selection\":{\"ref\":\"/notes/plan.md\",\"text\":\"Ship the native path\",\"position\":\"body; paragraph 2\"}}"
  }
]
```

```ts
nativeComposerCommandAcknowledgementFromDetail({ version: 1, id: "command-1", accepted: true })
=> {
  "version": 1,
  "id": "command-1",
  "accepted": true
}
```

```ts
nativeComposerCommandAcknowledgementFromDetail({ version: 1, id: "command-1", accepted: false })
=> null
```

## The V2 envelope

V1 stays exactly as it is, because installed iOS builds decode that shape and
nothing else. V2 is the envelope everything new rides: `kind` discriminates the
payload, and a command that carries no payload (`scan-controls`) is expressible
at all — which V1 is not, since its `selection` is decoded unconditionally.

```ts continue
JSON.stringify(nativeComposerCommandFromDetail({ version: 2, id: "c-2", kind: "scan-controls" }))
=> {"version":2,"id":"c-2","kind":"scan-controls"}
```

```ts continue
JSON.stringify(nativeComposerCommandFromDetail({
  version: 2,
  id: "c-3",
  kind: "add-selection",
  payload: { ref: "/notes/plan.md", text: "t", position: "line 1" },
}))
=> {"version":2,"id":"c-3","kind":"add-selection","payload":{"ref":"/notes/plan.md","text":"t","position":"line 1"}}
```

An unknown kind is refused rather than guessed at, the same way the Swift `Kind`
decode refuses it — that refusal is what turns a newer web bundle talking to an
older app into a visible rejection instead of a wrong action.

```ts continue
nativeComposerCommandFromDetail({ version: 2, id: "c-4", kind: "point-at-control" })
=> null
```

The envelope always carries a non-empty `id`, in every version. That is what
lets an old build's failed decode answer with a rejection rather than returning
silently.

```ts continue
nativeComposerCommandFromDetail({ version: 2, id: "  ", kind: "scan-controls" })
=> null
```

## The result channel

The acknowledgement stays `accepted`/`rejected`; the result is separate, so a
refusal with a reason and a successful *empty* inventory cannot be confused.

```ts continue
JSON.stringify(nativeCommandResultFromDetail({
  version: 2,
  id: "c-2",
  kind: "scan-controls",
  ok: true,
  controls: [{ id: "cb-composer-mic", role: "button", label: "Start dictation", container: "Composer", disabled: false }],
}))
=> {"version":2,"id":"c-2","kind":"scan-controls","ok":true,"controls":[{"id":"cb-composer-mic","role":"button","label":"Start dictation","does":null,"container":"Composer","disabled":false}]}
```

`does` is absent above, not null: Swift's `JSONEncoder` omits a nil optional
rather than writing one, so absent and null both mean "no description".

```ts continue
JSON.stringify(nativeCommandResultFromDetail({
  version: 2,
  id: "c-2",
  kind: "scan-controls",
  ok: false,
  reason: "the composer is not on screen",
}))
=> {"version":2,"id":"c-2","kind":"scan-controls","ok":false,"reason":"the composer is not on screen"}
```

A refusal without a reason, an entry with an unknown role, and a success with no
`controls` array are all malformed — the web reads a malformed result as no
answer at all.

```ts continue
[
  nativeCommandResultFromDetail({ version: 2, id: "c", kind: "scan-controls", ok: false }),
  nativeCommandResultFromDetail({ version: 2, id: "c", kind: "scan-controls", ok: true }),
  nativeCommandResultFromDetail({
    version: 2,
    id: "c",
    kind: "scan-controls",
    ok: true,
    controls: [{ id: "cb-x", role: "slider", label: "L", container: "Composer", disabled: false }],
  }),
  nativeCommandResultFromDetail({ version: 1, id: "c", kind: "scan-controls", ok: true, controls: [] }),
]
=> [
  null,
  null,
  null,
  null
]
```
