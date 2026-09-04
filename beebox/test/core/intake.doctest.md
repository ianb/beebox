# Intake stage

`runIntake` is the first stage of the triage pipeline. It does three things
in one pass:

1. Routes fresh top-level `_content/inbox/*` cards into `_content/inbox/intake/`,
   leaving reserved subdirectories alone.
2. Applies each registered intake step to every file in `intake/` until
   no step changes anything (quiescent).
3. Moves the intake-complete items to `_content/inbox/staged/`.

See `docs/triage.md` and `src/core/intake.ts`.

```ts setup
import { runIntake } from "../../src/core/intake.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Routing fresh arrivals

A top-level card in `_content/inbox/` gets pulled into `_content/inbox/intake/`,
then (since its filename is already safe) advanced through to
`_content/inbox/staged/`.

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/Note.memo.card", "<memo/>");

const result = await runIntake({ boxRoot: box.root });

JSON.stringify({
  routed: result.routed,
  applied: result.applied,
  staged: result.staged,
}, null, 2)
=>
{
  "routed": [
    "Note.memo.card"
  ],
  "applied": [],
  "staged": [
    "Note.memo.card"
  ]
}

await box.list("_content/inbox")
=>
_content/inbox/.gitkeep
_content/inbox/intake
_content/inbox/intake/.gitkeep
_content/inbox/staged
_content/inbox/staged/.gitkeep
_content/inbox/staged/Note.memo.card
_content/inbox/triaged
_content/inbox/triaged/.gitkeep
_content/inbox/triaged/_unsure
_content/inbox/triaged/_unsure/.gitkeep
_content/inbox/unhandled
_content/inbox/unhandled/.gitkeep

await box.list("_content/inbox/staged")
=>
_content/inbox/staged/.gitkeep
_content/inbox/staged/Note.memo.card
```

```ts cleanup
await box.cleanup();
```

## Filename normalization

A card with whitespace or shell-unsafe characters gets renamed; the
renamed file then advances to `staged/`.

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/Voice Memo (raw).memo.card", "<memo/>");

const result = await runIntake({ boxRoot: box.root });

JSON.stringify({
  applied: result.applied,
  staged: result.staged,
}, null, 2)
=>
{
  "applied": [
    {
      "step": "filename-normalization",
      "file": "Voice Memo (raw).memo.card",
      "newName": "Voice_Memo_raw.memo.card"
    }
  ],
  "staged": [
    "Voice_Memo_raw.memo.card"
  ]
}
```

```ts cleanup
await box.cleanup();
```

## Reserved subdirs are skipped

Items already sitting in `intake/`, `staged/`, or `triaged/` aren't
re-routed, and items in unrecognized subdirectories are left alone too.

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/Fresh.memo.card", "<memo/>");
await box.write("_content/inbox/oldbucket/Legacy.memo.card", "<memo/>");
await box.write("_content/inbox/staged/Already.memo.card", "<memo/>");

const result = await runIntake({ boxRoot: box.root });

JSON.stringify({
  routed: result.routed,
  staged: result.staged,
}, null, 2)
=>
{
  "routed": [
    "Fresh.memo.card"
  ],
  "staged": [
    "Fresh.memo.card"
  ]
}

await box.read("_content/inbox/oldbucket/Legacy.memo.card")
=> <memo/>

await box.read("_content/inbox/staged/Already.memo.card")
=> <memo/>
```

```ts cleanup
await box.cleanup();
```

## Non-card top-level files stay put

`_content/inbox/CLAUDE.md`, `MAP.md`, README files, and similar agent-facing
context don't get swept into intake. Only `*.card` files are routed.

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/CLAUDE.md", "# Inbox context");
await box.write("_content/inbox/MAP.md", "# Inbox map");
await box.write("_content/inbox/Note.memo.card", "<memo/>");

const result = await runIntake({ boxRoot: box.root });

JSON.stringify({ routed: result.routed, staged: result.staged })
=> {"routed":["Note.memo.card"],"staged":["Note.memo.card"]}

await box.read("_content/inbox/CLAUDE.md")
=> # Inbox context

await box.read("_content/inbox/MAP.md")
=> # Inbox map
```

```ts cleanup
await box.cleanup();
```

## Empty inbox is a no-op

```ts
const box = await makeTmpBox();

const result = await runIntake({ boxRoot: box.root });

JSON.stringify(result)
=> {"routed":[],"applied":[],"staged":[]}
```

```ts cleanup
await box.cleanup();
```
